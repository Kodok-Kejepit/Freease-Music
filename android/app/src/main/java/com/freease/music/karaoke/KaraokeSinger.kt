package com.freease.music.karaoke

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Build
import android.provider.MediaStore
import com.freease.music.data.model.Song
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.tanh

/**
 * Sesi nyanyi karaoke: mendengarkan mikrofon, membandingkan nada dengan vokal asli lagu (skor 0–100),
 * dan opsional merekam suaramu untuk digabung dengan musik karaokenya jadi satu berkas.
 */
class KaraokeSinger(private val context: Context) {
    data class Live(
        val active: Boolean = false,
        val recording: Boolean = false,
        val songId: String? = null,
        val score: Int = 0,
        /** Selisih nada sekarang (semitone, −6..6) atau NaN kalau salah satu tidak bernyanyi. */
        val diff: Float = Float.NaN,
        val singing: Boolean = false,
    )

    /** Hasil satu sesi (ditampilkan setelah selesai). */
    data class Result(
        val song: Song,
        val score: Int,
        val accuracy: Int,
        val coverage: Int,
        val recording: File?,
        val recordStartMs: Long,
    )

    private val _live = MutableStateFlow(Live())
    val live: StateFlow<Live> = _live.asStateFlow()

    @Volatile private var running = false
    private var thread: Thread? = null
    @Volatile var positionMs: Long = 0
    @Volatile var playing: Boolean = false

    private var song: Song? = null
    private var vocal: File? = null
    private var hits = 0f
    private var refFrames = 0
    private var sungFrames = 0
    private var recFile: File? = null
    private var recStartMs = 0L

    private val recDir = File(context.filesDir, "karaoke_recordings")

    /** Mulai sesi untuk [song] dengan trek vokal [vocalWav] sebagai acuan; [record] = rekam suara juga. */
    @SuppressLint("MissingPermission") // izin mikrofon diminta oleh UI sebelum memanggil
    fun start(song: Song, vocalWav: File, record: Boolean) {
        stop()
        this.song = song
        vocal = vocalWav
        hits = 0f; refFrames = 0; sungFrames = 0
        recFile = if (record) File(context.cacheDir, "sing_${System.currentTimeMillis()}.pcm") else null
        recStartMs = positionMs
        running = true
        _live.value = Live(active = true, recording = record, songId = song.id)
        thread = Thread({ loop() }, "freease-sing").also { it.start() }
    }

    /** Hentikan; @return hasil sesi (null kalau belum ada yang dinilai). */
    fun stop(): Result? {
        if (!running) return null
        running = false
        thread?.join(1_500)
        thread = null
        val s = song ?: return null
        _live.value = Live()
        if (refFrames < 20) { recFile?.delete(); return null }
        val accuracy = (hits / max(1, refFrames) * 100).toInt().coerceIn(0, 100)
        val coverage = (sungFrames * 100 / max(1, refFrames)).coerceIn(0, 100)
        // Skor: ketepatan nada, sedikit dikurangi kalau banyak bagian yang tidak dinyanyikan.
        val score = (accuracy * (0.75f + 0.25f * coverage / 100f)).toInt().coerceIn(0, 100)
        return Result(s, score, accuracy, coverage, recFile, recStartMs)
    }

    @SuppressLint("MissingPermission")
    private fun loop() {
        val rate = 44_100
        val hop = rate / 10 // 100 ms
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = runCatching { AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, hop * 8)) }.getOrNull()
        if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
            rec?.release(); running = false; _live.value = Live(); return
        }
        // Peredam gema: musik dari speaker HP tidak ikut terekam (paling bagus tetap pakai headset).
        val aec = runCatching { if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true } else null }.getOrNull()
        val buf = ShortArray(hop)
        val mic = FloatArray(2048)
        val refRaf = runCatching { RandomAccessFile(vocal!!, "r") }.getOrNull()
        val refRate = refRaf?.let { r -> runCatching { r.seek(24); Integer.reverseBytes(r.readInt()) }.getOrNull() } ?: 44_100
        val refBytes = ByteArray(2048 * 4)
        val ref = FloatArray(2048)
        val out = recFile?.let { BufferedOutputStream(FileOutputStream(it), 64 * 1024) }
        val outBytes = ByteBuffer.allocate(hop * 2).order(ByteOrder.LITTLE_ENDIAN)
        try {
            rec.startRecording()
            while (running) {
                val n = rec.read(buf, 0, hop)
                if (n <= 0) break
                if (out != null) {
                    outBytes.clear()
                    for (i in 0 until n) outBytes.putShort(buf[i])
                    out.write(outBytes.array(), 0, n * 2)
                }
                if (!playing) continue
                // 2048 sampel terakhir dari mikrofon.
                for (i in 0 until 2048) mic[i] = buf[(n - 2048 + i).coerceIn(0, n - 1)] / 32768f
                val sung = Pitch.yin(mic, 2048, rate)
                // Cuplikan vokal asli di posisi lagu yang sama.
                var target = 0f
                if (refRaf != null) {
                    val frame = positionMs * refRate / 1000
                    val off = KaraokeEngine.WAV_HEADER + frame * 4
                    if (off + refBytes.size <= refRaf.length()) {
                        refRaf.seek(off)
                        refRaf.readFully(refBytes)
                        val bb = ByteBuffer.wrap(refBytes).order(ByteOrder.LITTLE_ENDIAN)
                        for (i in 0 until 2048) ref[i] = (bb.short + bb.short) / 65536f
                        target = Pitch.yin(ref, 2048, refRate)
                    }
                }
                val diff = Pitch.semitoneDiff(sung, target)
                if (target > 0f) {
                    refFrames++
                    if (sung > 0f) sungFrames++
                    hits += Pitch.frameScore(diff)
                }
                val score = if (refFrames > 0) (hits / refFrames * 100).toInt() else 0
                _live.value = _live.value.copy(score = score, diff = diff, singing = sung > 0f)
            }
        } finally {
            runCatching { rec.stop() }
            aec?.release()
            rec.release()
            runCatching { refRaf?.close() }
            runCatching { out?.close() }
        }
    }

    /**
     * Gabungkan rekaman suara (PCM mono 44,1 kHz) dengan instrumen [instWav] mulai [startMs], lalu simpan
     * sebagai M4A di Musik/Freease Karaoke (dan di aplikasi untuk dibagikan). [latencyMs] menggeser suara
     * supaya pas dengan musik (jeda mikrofon & speaker).
     */
    suspend fun export(result: Result, instWav: File, latencyMs: Int = 150): File = withContext(Dispatchers.IO) {
        val voice = result.recording ?: error("Tidak ada rekaman")
        recDir.mkdirs()
        val instRate = RandomAccessFile(instWav, "r").use { r -> r.seek(24); Integer.reverseBytes(r.readInt()) }
        val voiceRate = 44_100
        val voiceSamples = voice.length() / 2
        val voiceAll = ShortArray(voiceSamples.toInt())
        ByteBuffer.wrap(voice.readBytes()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(voiceAll)
        val frames = (voiceSamples * instRate / voiceRate)
        val wav = File(context.cacheDir, "sing_mix.wav")
        RandomAccessFile(instWav, "r").use { inst ->
            BufferedOutputStream(FileOutputStream(wav), 256 * 1024).use { w ->
                w.write(KaraokeEngine.wavHeader(frames, instRate))
                val startFrame = result.recordStartMs * instRate / 1000
                inst.seek(KaraokeEngine.WAV_HEADER + startFrame * 4)
                val chunk = 4096
                val ib = ByteArray(chunk * 4)
                val ob = ByteBuffer.allocate(chunk * 4).order(ByteOrder.LITTLE_ENDIAN)
                val shift = latencyMs * voiceRate / 1000
                var f = 0L
                while (f < frames) {
                    val want = minOf(chunk.toLong(), frames - f).toInt()
                    val got = inst.read(ib, 0, want * 4).coerceAtLeast(0) / 4
                    val ibb = ByteBuffer.wrap(ib).order(ByteOrder.LITTLE_ENDIAN)
                    ob.clear()
                    for (i in 0 until want) {
                        val l = if (i < got) ibb.short / 32768f else 0f
                        val r = if (i < got) ibb.short / 32768f else 0f
                        // Resample suara (linear) ke rate instrumen, digeser maju sebesar latensi.
                        val pos = (f + i) * voiceRate.toDouble() / instRate + shift
                        val k = pos.toInt()
                        val t = (pos - k).toFloat()
                        val a = if (k in voiceAll.indices) voiceAll[k] / 32768f else 0f
                        val b = if (k + 1 in voiceAll.indices) voiceAll[k + 1] / 32768f else 0f
                        val v = (a + (b - a) * t) * 1.15f
                        ob.putShort((tanh(l * 0.8f + v) * 32767f).toInt().toShort())
                        ob.putShort((tanh(r * 0.8f + v) * 32767f).toInt().toShort())
                    }
                    w.write(ob.array(), 0, want * 4)
                    f += want
                }
            }
        }
        val safeTitle = result.song.title.replace(Regex("[^A-Za-z0-9 _-]"), "").trim().take(40).ifEmpty { "Lagu" }
        val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(java.util.Date())
        val out = File(recDir, "Karaoke - $safeTitle - $stamp.m4a")
        try {
            AacEncoder.encodeWav(wav, out, instRate, channels = 2, bitrate = 192_000)
        } finally {
            wav.delete()
            voice.delete()
        }
        // Salin juga ke folder Musik supaya muncul di aplikasi musik/galeri lain (Android 10+).
        if (Build.VERSION.SDK_INT >= 29) runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Audio.Media.DISPLAY_NAME, out.name)
                put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
                put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/Freease Karaoke")
                put(MediaStore.Audio.Media.TITLE, "${result.song.title} (Karaoke)")
                put(MediaStore.Audio.Media.ARTIST, "Freease Karaoke")
            }
            context.contentResolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)?.let { uri ->
                context.contentResolver.openOutputStream(uri)?.use { os -> out.inputStream().use { it.copyTo(os) } }
            }
        }
        out
    }

    /** Rekaman nyanyian yang tersimpan di aplikasi, terbaru dulu. */
    fun recordings(): List<File> = recDir.listFiles { f -> f.name.endsWith(".m4a") }.orEmpty().sortedByDescending { it.lastModified() }
}
