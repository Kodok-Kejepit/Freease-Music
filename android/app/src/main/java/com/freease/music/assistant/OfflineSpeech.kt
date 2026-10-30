package com.freease.music.assistant

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import com.freease.music.karaoke.DownloadSpec
import com.freease.music.karaoke.ModelDownloader
import com.freease.music.karaoke.ModelState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.File
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Pengenal ucapan offline milik Freease (Whisper base, ±77 MB, diunduh sekali di dalam aplikasi).
 * Dipakai saat tidak ada internet, jadi tidak perlu paket offline dari Google.
 */
class OfflineAsr(context: Context, client: OkHttpClient, private val scope: CoroutineScope) {
    val dir = File(context.filesDir, "asr/whisper-base")
    private val downloader by lazy { ModelDownloader(client) }
    private val _state = MutableStateFlow<ModelState>(if (ready()) ModelState.Ready else ModelState.Missing)
    val state: StateFlow<ModelState> = _state.asStateFlow()
    @Volatile private var recognizer: WhisperRecognizer? = null

    fun ready() = FILES.all { File(dir, it.fileName).length() == it.sizeBytes }

    fun download() {
        if (_state.value is ModelState.Downloading || ready()) return
        _state.value = ModelState.Downloading(0f)
        scope.launch(Dispatchers.IO) {
            val r = runCatching {
                dir.mkdirs()
                val total = FILES.sumOf { it.sizeBytes }.toFloat()
                var done = 0L
                for (f in FILES) {
                    val target = File(dir, f.fileName)
                    if (target.length() != f.sizeBytes) {
                        downloader.download(f, target) { p -> _state.value = ModelState.Downloading((done + p * f.sizeBytes) / total) }
                    }
                    done += f.sizeBytes
                }
            }
            _state.value = r.fold({ ModelState.Ready }, { ModelState.Failed(it.message ?: "Gagal mengunduh model") })
        }
    }

    /** Dimuat sekali (±1–2 dtk) lalu dipakai ulang sampai [release]. */
    @Synchronized
    fun load(): WhisperRecognizer = recognizer ?: WhisperRecognizer(dir, threads = max(2, minOf(4, Runtime.getRuntime().availableProcessors()))).also { recognizer = it }

    /** Muat (bila perlu) lalu kenali; terkunci bersama [release] supaya model tidak ditutup di tengah jalan. */
    @Synchronized
    fun transcribe(audio: FloatArray): String = load().transcribe(audio)

    /** Lepas memori model (±150 MB) di latar belakang, misalnya saat asisten ditutup. */
    fun releaseAsync() {
        scope.launch(Dispatchers.IO) { release() }
    }

    @Synchronized
    fun release() {
        recognizer?.close()
        recognizer = null
    }

    fun delete() {
        release()
        dir.deleteRecursively()
        _state.value = ModelState.Missing
    }

    companion object {
        private const val REV = "1846881b6b3a3024392c1eea3ad983695bc23925"
        private fun spec(path: String, size: Long, sha: String) = DownloadSpec(
            fileName = path.substringAfterLast('/'),
            sizeBytes = size,
            sha256 = sha,
            urls = listOf(
                "https://huggingface.co/onnx-community/whisper-base/resolve/$REV/$path",
                "https://hf-mirror.com/onnx-community/whisper-base/resolve/$REV/$path",
            ),
        )
        val FILES = listOf(
            spec("vocab.json", 1_036_584, "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a"),
            spec("onnx/${WhisperRecognizer.ENCODER}", 23_201_297, "ca6177401f86a2c6b4dc5f7fc02fbca680678906bd0c22f6d89f0b80f124253f"),
            spec("onnx/${WhisperRecognizer.DECODER}", 53_693_315, "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"),
        )
        val TOTAL_BYTES = FILES.sumOf { it.sizeBytes }
    }
}

/**
 * Merekam satu perintah lalu mengenalinya dengan [OfflineAsr]. Rekaman berhenti sendiri setelah
 * ±0,9 dtk hening sesudah bicara (maks. 10 dtk). Callback dipanggil di thread utama.
 */
class OfflineListener(private val asr: OfflineAsr) {
    private val main = Handler(Looper.getMainLooper())
    /** Nomor sesi; sesi lama yang masih berjalan diam-diam diabaikan setelah [stop]/[start] baru. */
    @Volatile private var session = 0

    @SuppressLint("MissingPermission") // izin diperiksa pemanggil (AssistantSheet)
    fun start(cb: SpeechListener.Callback) {
        val id = ++session
        Thread({ run(cb, id) }, "freease-asr").start()
    }

    fun stop() {
        session++
    }

    @SuppressLint("MissingPermission")
    private fun run(cb: SpeechListener.Callback, id: Int) {
        fun active() = session == id
        fun post(block: () -> Unit) = main.post { if (active()) block() }
        val rate = WhisperFeatures.SAMPLE_RATE
        val chunk = rate * 30 / 1000 // 30 ms
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = runCatching {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, chunk * 8))
        }.getOrNull()
        if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
            rec?.release()
            post { cb.onError("Mikrofon bermasalah") }
            return
        }
        val ns = runCatching { if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true } else null }.getOrNull()
        // Muat model sambil mulai merekam supaya tidak ada jeda.
        val loader = Thread { runCatching { asr.load() } }.also { it.start() }
        val audio = FloatArray(rate * 10)
        var len = 0
        val buf = ShortArray(chunk)
        var floor = 0.004f
        var speechAt = -1
        var lastVoice = 0
        var chunks = 0
        var heard = false
        try {
            rec.startRecording()
            post { cb.onReady() }
            while (active()) {
                val n = rec.read(buf, 0, chunk)
                if (n <= 0) break
                var e = 0.0
                for (i in 0 until n) {
                    val v = buf[i] / 32768f
                    if (len < audio.size) audio[len++] = v
                    e += v * v
                }
                chunks++
                val rms = sqrt(e / n).toFloat()
                // Lantai derau diperkirakan dari 300 ms pertama, lalu mengikuti perlahan saat hening.
                if (chunks <= 10) floor = max(floor, rms) else if (rms < floor * 2) floor = floor * 0.95f + rms * 0.05f
                val voice = rms > max(floor * 3f, 0.012f)
                post { cb.onLevel((rms * 12f).coerceIn(0f, 1f)) }
                if (voice) {
                    if (speechAt < 0) speechAt = len
                    lastVoice = len
                    heard = true
                }
                val silenceMs = (len - lastVoice) * 1000 / rate
                when {
                    heard && silenceMs > 900 && (lastVoice - speechAt) > rate / 5 -> break
                    !heard && len > rate * 6 -> break
                    len >= audio.size -> break
                }
            }
        } finally {
            runCatching { rec.stop() }
            ns?.release()
            rec.release()
        }
        if (!active()) return
        if (!heard) { post { cb.onError("Tidak ada suara yang terdengar") }; return }
        post { cb.onPartial("Memproses…") }
        val from = max(0, speechAt - rate * 3 / 10)
        val clip = audio.copyOfRange(from, minOf(len, lastVoice + rate * 3 / 10))
        loader.join()
        val text = runCatching { asr.transcribe(clip) }
        if (!active()) return
        text.fold(
            { t -> post { if (t.isBlank()) cb.onError("Tidak ada suara yang terdengar") else cb.onResult(t) } },
            { e -> post { cb.onError("Pengenal offline gagal: ${e.message}") } },
        )
    }
}
