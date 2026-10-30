package com.freease.music.karaoke

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.net.Uri
import com.freease.music.data.model.Song
import com.freease.music.data.youtube.YouTubeRepository
import com.freease.music.data.prefs.AudioQuality
import com.freease.music.util.RangedDownload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/** Status persiapan karaoke untuk satu lagu. */
sealed interface KaraokeJob {
    /** [phase]: teks singkat ("Mengunduh lagu", "Memisahkan vokal", …); [progress] 0..1; [speed] = kali waktu nyata. */
    data class Preparing(val phase: String, val progress: Float, val speed: Float = 0f, val etaSec: Int = -1) : KaraokeJob
    data object Ready : KaraokeJob
    data class Failed(val message: String) : KaraokeJob
}

/** Status unduhan model AI. */
sealed interface ModelState {
    data object Missing : ModelState
    data class Downloading(val progress: Float) : ModelState
    data object Ready : ModelState
    data class Failed(val message: String) : ModelState
}

/**
 * Mesin Mode Karaoke berbasis AI. Lagu didekode, vokalnya dipisahkan model MDX-Net potongan demi
 * potongan, dan instrumennya ditulis ke berkas WAV yang bisa langsung diputar sambil diproses
 * ([KaraokeDataSource] menunggu bagian yang belum jadi). Hasil disimpan di cache (6 lagu terakhir).
 */
class KaraokeEngine(
    private val context: Context,
    private val youtube: YouTubeRepository,
    private val client: OkHttpClient,
    private val localPath: suspend (String) -> String?,
    private val scope: CoroutineScope,
) {
    private val modelDir = File(context.filesDir, "karaoke_models")
    private val cacheDir = File(context.cacheDir, "karaoke")

    /** Karaoke tersimpan permanen (halaman "Karaoke tersimpan"); tiap hasil yang selesai otomatis disimpan. */
    val library = KaraokeLibrary(File(context.filesDir, "karaoke_saved"))

    /** Lagu yang sedang dikompres untuk disimpan (id). */
    private val _saving = MutableStateFlow<Set<String>>(emptySet())
    val saving: StateFlow<Set<String>> = _saving.asStateFlow()

    private val _jobs = MutableStateFlow<Map<String, KaraokeJob>>(emptyMap())
    val jobs: StateFlow<Map<String, KaraokeJob>> = _jobs.asStateFlow()

    private val _model = MutableStateFlow<Map<String, ModelState>>(emptyMap())
    val modelStates: StateFlow<Map<String, ModelState>> = _model.asStateFlow()

    /** Berkas keluaran yang sedang/sudah ditulis, untuk [KaraokeDataSource]. */
    class Output(val file: File, val totalBytes: Long, val sampleRate: Int) {
        @Volatile var written = 0L
        @Volatile var done = false
        @Volatile var error: String? = null
        @Volatile var processedFrames = 0L
        val lock = Object()
        fun notifyAllWaiting() = synchronized(lock) { lock.notifyAll() }
    }

    private val outputs = java.util.concurrent.ConcurrentHashMap<String, Output>()
    private val workers = HashMap<String, Job>()
    private val separateLock = Mutex()
    private var session: Pair<String, OrtSession>? = null
    private val env by lazy { OrtEnvironment.getEnvironment() }

    init {
        refreshModels()
    }

    // ------------------------------------------------------------------ model

    fun modelFile(m: MdxModel) = File(modelDir, m.fileName)

    fun isDownloaded(m: MdxModel) = modelFile(m).length() == m.sizeBytes

    private fun refreshModels() {
        _model.value = MdxModel.ALL.associate { it.id to (if (isDownloaded(it)) ModelState.Ready else ModelState.Missing) }
    }

    private val downloader by lazy { ModelDownloader(client) }

    /** Unduh model (sekali saja); aman dipanggil berulang. */
    fun downloadModel(m: MdxModel) {
        val st = _model.value[m.id]
        if (st is ModelState.Downloading || st is ModelState.Ready) return
        _model.update { it + (m.id to ModelState.Downloading(0f)) }
        scope.launch(Dispatchers.IO) {
            val r = runCatching {
                modelDir.mkdirs()
                downloader.download(m, modelFile(m)) { p -> _model.update { it + (m.id to ModelState.Downloading(p)) } }
            }
            _model.update {
                it + (m.id to r.fold({ ModelState.Ready }, { e -> ModelState.Failed(e.message ?: "Gagal mengunduh model") }))
            }
        }
    }

    /**
     * Impor berkas model yang diunduh sendiri (mis. lewat browser/VPN). Dikenali dari SHA-256-nya;
     * mengembalikan model yang cocok.
     */
    suspend fun importModel(source: Uri): MdxModel = withContext(Dispatchers.IO) {
        modelDir.mkdirs()
        val tmp = File(modelDir, "import.tmp")
        try {
            context.contentResolver.openInputStream(source)?.use { input ->
                tmp.outputStream().use { input.copyTo(it, 1 shl 16) }
            } ?: throw IOException("Berkas tidak bisa dibaca")
            val hash = ModelDownloader.sha256(tmp)
            val m = MdxModel.ALL.firstOrNull { it.sha256 == hash }
                ?: throw IOException("Bukan berkas model yang dikenali. Pilih ${MdxModel.ALL.joinToString(" atau ") { it.fileName }}.")
            if (!tmp.renameTo(modelFile(m))) throw IOException("Gagal menyimpan model")
            _model.update { it + (m.id to ModelState.Ready) }
            m
        } finally {
            tmp.delete()
        }
    }

    fun deleteModels() {
        cancelAll()
        scope.launch {
            separateLock.withLock {
                session?.second?.let { runCatching { it.close() } }
                session = null
                modelDir.listFiles()?.forEach { it.delete() }
                refreshModels()
            }
        }
    }

    fun cacheBytes(): Long = (cacheDir.listFiles()?.sumOf { it.length() } ?: 0L) + (modelDir.listFiles()?.sumOf { it.length() } ?: 0L)

    private fun sessionFor(m: MdxModel): OrtSession {
        session?.let { (id, s) -> if (id == m.id) return s }
        session?.second?.let { runCatching { it.close() } }
        session = null
        val opts = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            // Sisakan inti CPU untuk pemutaran & tampilan supaya HP tidak tersendat/panas berlebihan.
            val threads = (Runtime.getRuntime().availableProcessors() - 2).coerceIn(2, 4)
            setIntraOpNumThreads(threads)
            // XNNPACK mempercepat konvolusi di CPU ARM; abaikan kalau tidak tersedia.
            runCatching { addXnnpack(mapOf("intra_op_num_threads" to "$threads")) }
        }
        val s = env.createSession(modelFile(m).path, opts)
        session = m.id to s
        return s
    }

    /** Lepas memori model (dipanggil saat Mode Karaoke dimatikan) — setelah pemrosesan yang berjalan berhenti. */
    fun closeSession() {
        scope.launch {
            separateLock.withLock {
                session?.second?.let { runCatching { it.close() } }
                session = null
            }
        }
    }

    // ------------------------------------------------------------------ lagu

    private fun key(m: MdxModel, id: String) = "${m.id}_${id.replace(Regex("[^A-Za-z0-9_-]"), "_")}"
    private fun outFile(m: MdxModel, id: String) = File(cacheDir, key(m, id) + ".wav")

    /** Trek vokal (lagu asli − instrumen) dengan format sama; untuk volume vokal & skor karaoke. */
    fun vocalFile(m: MdxModel, id: String) = File(cacheDir, key(m, id) + ".vox.wav")

    /** Volume vokal asli yang dicampurkan saat diputar (0 = hilang, 1 = utuh). */
    @Volatile var vocalGain = 0f
    private fun doneMarker(m: MdxModel, id: String) = File(cacheDir, key(m, id) + ".done")

    /** Berkas keluaran untuk diputar; null kalau belum mulai. */
    fun output(m: MdxModel, id: String): Output? {
        outputs[key(m, id)]?.let { return it }
        val f = outFile(m, id)
        if (doneMarker(m, id).exists() && f.exists()) {
            val rate = readRate(f) ?: return null
            return Output(f, f.length(), rate).also { it.written = f.length(); it.done = true; outputs[key(m, id)] = it }
        }
        return null
    }

    /** Daftarkan berkas keluaran yang sedang ditulis (dipakai [prepare]; juga untuk pengujian). */
    internal fun attach(m: MdxModel, id: String, o: Output) {
        outputs[key(m, id)] = o
    }

    fun isComplete(m: MdxModel, id: String) = library.has(id) || output(m, id)?.done == true

    /**
     * Boleh mulai memutar versi karaoke dari [positionMs] tanpa tersendat? Ya kalau sudah selesai, atau
     * kecepatan proses cukup sehingga sisa lagu akan selesai diproses sebelum terdengar.
     */
    fun canPlay(m: MdxModel, id: String, positionMs: Long): Boolean {
        if (library.has(id)) return true
        val o = output(m, id) ?: return false
        if (o.done) return true
        val job = _jobs.value[id] as? KaraokeJob.Preparing ?: return false
        if (job.speed <= 0f) return false
        val totalFrames = (o.totalBytes - WAV_HEADER) / 4
        val doneSec = o.processedFrames.toDouble() / o.sampleRate
        val totalSec = totalFrames.toDouble() / o.sampleRate
        val posSec = positionMs / 1000.0
        if (doneSec < posSec + 8) return false
        val remainingProcess = (totalSec - doneSec) / job.speed
        val remainingPlayback = totalSec - posSec
        return remainingProcess < (remainingPlayback - 6) * 0.9
    }

    /** Siapkan [song] (urutan diproses sesuai panggilan; [first] = lagu yang sedang diputar didahulukan). */
    fun request(m: MdxModel, song: Song, first: Boolean) {
        if (!isDownloaded(m) || song.isLive) return
        if (isComplete(m, song.id) || workers[song.id]?.isActive == true) return
        if (first) {
            // Hentikan persiapan lain (mis. lagu yang sudah dilewati) supaya lagu ini tidak menunggu.
            workers.filterKeys { it != song.id }.values.forEach { it.cancel() }
        }
        _jobs.update { it + (song.id to KaraokeJob.Preparing("Menunggu giliran", 0f)) }
        workers[song.id] = scope.launch(Dispatchers.Default) {
            val result = runCatching { prepare(m, song) }
            val err = result.exceptionOrNull()
            if (err is kotlinx.coroutines.CancellationException) {
                _jobs.update { it - song.id }
            } else {
                _jobs.update { it + (song.id to if (err == null) KaraokeJob.Ready else KaraokeJob.Failed(err.message ?: "Gagal menyiapkan karaoke")) }
            }
        }
    }

    fun cancelAll() {
        workers.values.forEach { it.cancel() }
        workers.clear()
        _jobs.value = _jobs.value.filterValues { it is KaraokeJob.Ready }
    }

    private fun setJob(id: String, j: KaraokeJob) = _jobs.update { it + (id to j) }

    private suspend fun prepare(m: MdxModel, song: Song) = separateLock.withLock {
        cacheDir.mkdirs()
        val id = song.id
        val tmpSrc = File(cacheDir, key(m, id) + ".src")
        val tmpPcm = File(cacheDir, key(m, id) + ".pcm")
        val out = outFile(m, id)
        val k = key(m, id)
        try {
            // 1. Sumber audio: berkas di HP, unduhan, atau stream YouTube kualitas tertinggi.
            val uri: Uri = when {
                com.freease.music.data.local.LocalSongs.isLocal(id) -> com.freease.music.data.local.LocalSongs.contentUri(id)
                else -> localPath(id)?.let { Uri.fromFile(File(it)) } ?: run {
                    setJob(id, KaraokeJob.Preparing("Mengambil lagu", 0f))
                    val info = youtube.streamInfo(id)
                    val stream = youtube.pickAudio(info, AudioQuality.MAX) ?: throw IOException("Stream audio tidak tersedia")
                    try {
                        RangedDownload.fetch(client, stream.url, tmpSrc, MAX_SOURCE_BYTES) { p -> setJob(id, KaraokeJob.Preparing("Mengambil lagu", p * 0.1f)) }
                    } catch (e: IOException) {
                        youtube.invalidate(id)
                        throw if (e is RangedDownload.TooLargeException) IOException("Lagu terlalu panjang untuk karaoke") else e
                    }
                    Uri.fromFile(tmpSrc)
                }
            }
            // 2. Dekode ke PCM mentah (ukuran pasti → header WAV pasti).
            val ctx = currentCoroutineContext()
            setJob(id, KaraokeJob.Preparing("Membaca lagu", 0.1f))
            val pcm = withContext(Dispatchers.IO) {
                PcmDecoder.decode(context, uri, tmpPcm, { ctx.isActive }) { p -> setJob(id, KaraokeJob.Preparing("Membaca lagu", 0.1f + p * 0.05f)) }
            }
            tmpSrc.delete()
            if (pcm.sampleRate !in 32_000..50_000) throw IOException("Format audio tidak didukung (${pcm.sampleRate} Hz)")

            // 3. Pisahkan vokal, tulis WAV bertahap.
            val total = WAV_HEADER + pcm.frames * 4
            val o = Output(out, total, pcm.sampleRate)
            attach(m, id, o)
            doneMarker(m, id).delete()
            val s = sessionFor(m)
            val shape = longArrayOf(1, 4, m.dimF.toLong(), m.dimT.toLong())
            val inputName = s.inputNames.first()
            // Buffer langsung (direct) dipakai ulang: ONNX Runtime membacanya tanpa salinan tambahan (±25% lebih cepat).
            val direct = ByteBuffer.allocateDirect(4 * m.dimF * m.dimT * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
            val sep = MdxSeparator(m) { x, y ->
                direct.clear()
                direct.put(x)
                direct.rewind()
                OnnxTensor.createTensor(env, direct, shape).use { t ->
                    s.run(mapOf(inputName to t)).use { r ->
                        (r[0] as OnnxTensor).floatBuffer.get(y)
                    }
                }
            }
            val t0 = System.nanoTime()
            val vox = vocalFile(m, id)
            RandomAccessFile(out, "rw").use { raf ->
              RandomAccessFile(vox, "rw").use { voxRaf ->
               RandomAccessFile(tmpPcm, "r").use { mixRaf ->
                voxRaf.setLength(0)
                voxRaf.write(wavHeader(pcm.frames, pcm.sampleRate))
                val mixBytes = ByteArray(m.gen * 4)
                val voxBytes = ByteBuffer.allocate(m.gen * 4).order(ByteOrder.LITTLE_ENDIAN)
                raf.setLength(0)
                raf.write(wavHeader(pcm.frames, pcm.sampleRate))
                o.written = WAV_HEADER.toLong()
                BufferedInputStream(FileInputStream(tmpPcm), 256 * 1024).use { input ->
                    val inBytes = ByteArray(m.gen * 4)
                    val outBytes = ByteBuffer.allocate(m.gen * 4).order(ByteOrder.LITTLE_ENDIAN)
                    sep.separate(
                        read = { buf, max ->
                            var got = 0
                            val want = max * 4
                            while (got < want) {
                                val n = input.read(inBytes, got, want - got)
                                if (n < 0) break
                                got += n
                            }
                            val frames = got / 4
                            val bb = ByteBuffer.wrap(inBytes, 0, frames * 4).order(ByteOrder.LITTLE_ENDIAN)
                            for (i in 0 until frames * 2) buf[i] = bb.short / 32768f
                            frames
                        },
                        write = { buf, frames ->
                            outBytes.clear()
                            for (i in 0 until frames * 2) outBytes.putShort((buf[i] * 32767f).coerceIn(-32768f, 32767f).toInt().toShort())
                            // Vokal = lagu asli − instrumen, pada frame yang sama.
                            mixRaf.seek(o.processedFrames * 4)
                            mixRaf.readFully(mixBytes, 0, frames * 4)
                            val mixBuf = ByteBuffer.wrap(mixBytes, 0, frames * 4).order(ByteOrder.LITTLE_ENDIAN)
                            voxBytes.clear()
                            for (i in 0 until frames * 2) {
                                val v = mixBuf.short - (buf[i] * 32767f)
                                voxBytes.putShort(v.coerceIn(-32768f, 32767f).toInt().toShort())
                            }
                            voxRaf.write(voxBytes.array(), 0, frames * 4)
                            raf.write(outBytes.array(), 0, frames * 4)
                            o.processedFrames += frames
                            o.written += frames * 4L
                            o.notifyAllWaiting()
                            val sec = (System.nanoTime() - t0) / 1e9
                            val doneSec = o.processedFrames.toDouble() / pcm.sampleRate
                            val speed = if (sec > 0) (doneSec / sec).toFloat() else 0f
                            val progress = o.processedFrames.toFloat() / pcm.frames
                            val eta = if (speed > 0) ((pcm.frames - o.processedFrames).toDouble() / pcm.sampleRate / speed).toInt() else -1
                            setJob(id, KaraokeJob.Preparing("Memisahkan vokal", 0.15f + 0.85f * progress, speed, eta))
                        },
                        isActive = { ctx.isActive },
                    )
                }
               }
              }
            }
            o.done = true
            o.notifyAllWaiting()
            doneMarker(m, id).createNewFile()
            // Simpan permanen (dikompres) di latar; cache WAV dirapikan setelahnya supaya tidak terhapus di tengah jalan.
            _saving.update { it + id }
            scope.launch(Dispatchers.IO) {
                runCatching { library.save(song, m.id, out, pcm.sampleRate, vox.takeIf { it.exists() }) }
                _saving.update { it - id }
                trimCache()
            }
        } catch (e: Throwable) {
            outputs.remove(k)?.let { it.error = e.message ?: "Gagal"; it.notifyAllWaiting() }
            out.delete()
            vocalFile(m, id).delete()
            throw e
        } finally {
            tmpSrc.delete()
            tmpPcm.delete()
        }
    }

    /** Simpan hanya [MAX_CACHED] hasil terakhir. */
    private fun trimCache() {
        val done = cacheDir.listFiles { f -> f.name.endsWith(".done") }?.sortedByDescending { it.lastModified() } ?: return
        done.drop(MAX_CACHED).forEach { marker ->
            val base = marker.name.removeSuffix(".done")
            outputs.remove(base)
            File(cacheDir, "$base.wav").delete()
            File(cacheDir, "$base.vox.wav").delete()
            marker.delete()
        }
    }

    /**
     * Karaoke tersimpan (AAC) → WAV di cache lagi (±2–4 dtk), supaya volume vokal & skor karaoke bisa
     * dipakai tanpa memproses ulang dengan AI.
     */
    suspend fun restoreSaved(m: MdxModel, id: String): Boolean = withContext(Dispatchers.IO) {
        if (output(m, id)?.done == true && vocalFile(m, id).exists()) return@withContext true
        val inst = library.file(id) ?: return@withContext false
        val voxAac = library.vocalFile(id) ?: return@withContext false
        cacheDir.mkdirs()
        runCatching {
            fun toWav(src: File, dst: File): Int {
                val raw = File(cacheDir, dst.name + ".raw")
                try {
                    val pcm = PcmDecoder.decode(context, Uri.fromFile(src), raw, { true }) {}
                    RandomAccessFile(dst, "rw").use { w ->
                        w.setLength(0)
                        w.write(wavHeader(pcm.frames, pcm.sampleRate))
                        raw.inputStream().buffered(256 * 1024).use { it.copyTo(java.io.FileOutputStream(w.fd)) }
                    }
                    return pcm.sampleRate
                } finally {
                    raw.delete()
                }
            }
            toWav(voxAac, vocalFile(m, id))
            toWav(inst, outFile(m, id))
            doneMarker(m, id).createNewFile()
            outputs.remove(key(m, id))
            output(m, id) != null
        }.getOrElse {
            outFile(m, id).delete(); vocalFile(m, id).delete(); doneMarker(m, id).delete()
            false
        }
    }

    fun clearCache() {
        cancelAll()
        outputs.clear()
        cacheDir.listFiles()?.forEach { it.delete() }
        _jobs.value = emptyMap()
    }

    companion object {
        const val SCHEME = "freease-karaoke"
        const val WAV_HEADER = 44
        const val MAX_CACHED = 6
        const val MAX_SOURCE_BYTES = 40L * 1024 * 1024

        fun uriFor(m: MdxModel, id: String): String = "$SCHEME://${m.id}/${Uri.encode(id)}"

        fun wavHeader(frames: Long, rate: Int): ByteArray {
            val data = frames * 4
            return ByteBuffer.allocate(WAV_HEADER).order(ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray()); putInt((36 + data).toInt()); put("WAVE".toByteArray())
                put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(2); putInt(rate); putInt(rate * 4); putShort(4); putShort(16)
                put("data".toByteArray()); putInt(data.toInt())
            }.array()
        }

        private fun readRate(f: File): Int? = runCatching {
            RandomAccessFile(f, "r").use { r ->
                val b = ByteArray(WAV_HEADER); r.readFully(b)
                ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).getInt(24)
            }
        }.getOrNull()
    }
}
