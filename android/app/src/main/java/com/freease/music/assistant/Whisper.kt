package com.freease.music.assistant

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.Closeable
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Log-mel 80 × 3000 persis seperti Whisper (16 kHz, jendela 400, langkah 160, 30 detik). */
object WhisperFeatures {
    const val SAMPLE_RATE = 16_000
    const val N_MELS = 80
    const val FRAMES = 3000
    private const val N_FFT = 400
    private const val HOP = 160
    private const val BINS = N_FFT / 2 + 1
    private const val SAMPLES = SAMPLE_RATE * 30

    private val window = FloatArray(N_FFT) { (0.5 - 0.5 * cos(2 * PI * it / N_FFT)).toFloat() }
    private val cosT = FloatArray(BINS * N_FFT) { val k = it / N_FFT; val n = it % N_FFT; cos(2 * PI * k * n / N_FFT).toFloat() }
    private val sinT = FloatArray(BINS * N_FFT) { val k = it / N_FFT; val n = it % N_FFT; sin(2 * PI * k * n / N_FFT).toFloat() }

    /** Filter mel gaya Slaney (sama dengan librosa yang dipakai Whisper). */
    val filters: Array<FloatArray> by lazy {
        fun hzToMel(f: Double) = if (f >= 1000.0) 15.0 + ln(f / 1000.0) / (ln(6.4) / 27.0) else f / (200.0 / 3)
        fun melToHz(m: Double) = if (m >= 15.0) 1000.0 * exp(ln(6.4) / 27.0 * (m - 15.0)) else m * (200.0 / 3)
        val top = hzToMel(SAMPLE_RATE / 2.0)
        val pts = DoubleArray(N_MELS + 2) { melToHz(top * it / (N_MELS + 1)) }
        Array(N_MELS) { i ->
            FloatArray(BINS) { b ->
                val f = b * (SAMPLE_RATE / 2.0) / (BINS - 1)
                val lo = (f - pts[i]) / (pts[i + 1] - pts[i])
                val hi = (pts[i + 2] - f) / (pts[i + 2] - pts[i + 1])
                (max(0.0, min(lo, hi)) * 2.0 / (pts[i + 2] - pts[i])).toFloat()
            }
        }
    }

    /** [audio] mono 16 kHz (−1..1), dipotong/diisi nol jadi 30 detik. Hasil berurutan [mel][frame]. */
    fun compute(audio: FloatArray): FloatArray {
        val n = min(audio.size, SAMPLES)
        // Padding "reflect" 200 sampel di kedua sisi (center = True).
        fun sample(i: Int): Float {
            var j = i - N_FFT / 2
            if (j < 0) j = -j
            if (j >= SAMPLES) j = 2 * (SAMPLES - 1) - j
            return if (j < n) audio[j] else 0f
        }
        val out = FloatArray(N_MELS * FRAMES)
        val frame = FloatArray(N_FFT)
        val power = FloatArray(BINS)
        // Frame yang seluruhnya jatuh di bagian nol cukup bernilai log(1e-10); hanya frame berisi suara dihitung.
        val active = min(FRAMES, (n + N_FFT / 2) / HOP + 1)
        var maxLog = -10f
        for (t in 0 until FRAMES) {
            if (t < active) {
                for (i in 0 until N_FFT) frame[i] = sample(t * HOP + i) * window[i]
                for (k in 0 until BINS) {
                    var re = 0f
                    var im = 0f
                    val base = k * N_FFT
                    for (i in 0 until N_FFT) {
                        re += frame[i] * cosT[base + i]
                        im -= frame[i] * sinT[base + i]
                    }
                    power[k] = re * re + im * im
                }
                for (m in 0 until N_MELS) {
                    val w = filters[m]
                    var s = 0f
                    for (k in 0 until BINS) s += w[k] * power[k]
                    val v = log10(max(s, 1e-10f))
                    out[m * FRAMES + t] = v
                    if (v > maxLog) maxLog = v
                }
            } else {
                for (m in 0 until N_MELS) out[m * FRAMES + t] = -10f
            }
        }
        val floor = maxLog - 8f
        for (i in out.indices) out[i] = (max(out[i], floor) + 4f) / 4f
        return out
    }
}

/** Mengubah token Whisper (BPE tingkat byte) kembali menjadi teks. */
class WhisperTokenizer(vocabJson: String) {
    private val tokens: Array<String?>
    private val byteOf = IntArray(512) { -1 }

    init {
        val map = parseVocab(vocabJson)
        tokens = arrayOfNulls((map.values.maxOrNull() ?: 0) + 1)
        for ((k, v) in map) tokens[v] = k
        val bs = ArrayList<Int>()
        bs += '!'.code..'~'.code; bs += 0xA1..0xAC; bs += 0xAE..0xFF
        val cs = ArrayList(bs)
        var extra = 0
        for (b in 0 until 256) if (b !in bs) { bs += b; cs += 256 + extra++ }
        for (i in bs.indices) byteOf[cs[i]] = bs[i]
    }

    fun decode(ids: List<Int>): String {
        val out = java.io.ByteArrayOutputStream()
        for (id in ids) {
            if (id >= EOT) continue
            tokens.getOrNull(id)?.forEach { ch -> byteOf.getOrNull(ch.code)?.takeIf { it >= 0 }?.let(out::write) }
        }
        return out.toString(Charsets.UTF_8.name()).trim()
    }

    companion object {
        const val EOT = 50257

        /** vocab.json berupa objek datar {"token": id}; dibaca manual supaya tidak bergantung org.json. */
        fun parseVocab(s: String): Map<String, Int> {
            val map = HashMap<String, Int>(60_000)
            var i = s.indexOf('{') + 1
            val sb = StringBuilder()
            while (i < s.length) {
                while (i < s.length && s[i] != '"' && s[i] != '}') i++
                if (i >= s.length || s[i] == '}') break
                i++
                sb.setLength(0)
                while (s[i] != '"') {
                    if (s[i] == '\\') {
                        i++
                        when (s[i]) {
                            'n' -> sb.append('\n'); 't' -> sb.append('\t'); 'r' -> sb.append('\r')
                            'b' -> sb.append('\b'); 'f' -> sb.append('\u000c')
                            'u' -> { sb.append(s.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                            else -> sb.append(s[i])
                        }
                    } else sb.append(s[i])
                    i++
                }
                i++
                while (s[i] != ':') i++
                i++
                while (s[i] == ' ') i++
                val start = i
                while (i < s.length && (s[i].isDigit() || s[i] == '-')) i++
                map[sb.toString()] = s.substring(start, i).toInt()
            }
            return map
        }
    }
}

/**
 * Pengenal ucapan offline (Whisper, ONNX Runtime) untuk bahasa Indonesia. Model: encoder + decoder
 * "merged" (dengan cache kunci/nilai), dekode serakah tanpa cap waktu.
 */
class WhisperRecognizer(dir: File, threads: Int = 4) : Closeable {
    private val env = OrtEnvironment.getEnvironment()
    private val opts = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(threads)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    }
    private val encoder = env.createSession(File(dir, ENCODER).path, opts)
    private val decoder = env.createSession(File(dir, DECODER).path, opts)
    private val tokenizer = WhisperTokenizer(File(dir, VOCAB).readText())
    private val layers = decoder.inputNames.count { it.endsWith("decoder.key") }
    private val heads: Long
    private val headDim: Long

    init {
        val info = decoder.inputInfo["past_key_values.0.decoder.key"]!!.info as ai.onnxruntime.TensorInfo
        heads = info.shape[1]
        headDim = info.shape[3]
    }

    /** @return teks hasil pengenalan (kosong bila tidak ada ucapan). */
    fun transcribe(audio: FloatArray, maxTokens: Int = 64): String {
        val mel = WhisperFeatures.compute(audio)
        val hidden = OnnxTensor.createTensor(env, FloatBuffer.wrap(mel), longArrayOf(1, WhisperFeatures.N_MELS.toLong(), WhisperFeatures.FRAMES.toLong())).use { input ->
            encoder.run(mapOf("input_features" to input)).use { r ->
                val t = r[0] as OnnxTensor
                OnnxTensor.createTensor(env, t.floatBuffer, t.info.shape)
            }
        }
        val out = ArrayList<Int>()
        val owned = ArrayList<OnnxTensor>()
        try {
            owned += hidden
            val empty = OnnxTensor.createTensor(env, FloatBuffer.allocate(0), longArrayOf(1, heads, 0, headDim)).also { owned += it }
            var past = HashMap<String, OnnxTensor>()
            for (l in 0 until layers) for (k in KV) past["past_key_values.$l.$k"] = empty
            var ids = PROMPT
            var cache = false
            var first: OrtSession.Result? = null // memegang kunci/nilai encoder sampai selesai
            var prev: OrtSession.Result? = null
            try {
                for (step in 0 until maxTokens) {
                    val inputIds = OnnxTensor.createTensor(env, LongBuffer.wrap(ids), longArrayOf(1, ids.size.toLong()))
                    val useCache = OnnxTensor.createTensor(env, booleanArrayOf(cache))
                    val feed = HashMap<String, OnnxTensor>(past)
                    feed["input_ids"] = inputIds
                    feed["encoder_hidden_states"] = hidden
                    feed["use_cache_branch"] = useCache
                    val r = try { decoder.run(feed) } finally { inputIds.close(); useCache.close() }
                    val logits = r[0] as OnnxTensor
                    val shape = logits.info.shape
                    val vocab = shape[2].toInt()
                    val buf = logits.floatBuffer
                    val off = (shape[1].toInt() - 1) * vocab
                    var best = -1
                    var bestV = Float.NEGATIVE_INFINITY
                    for (v in 0 until min(vocab, NO_TIMESTAMPS)) {
                        if (v in SUPPRESS) continue
                        if (step == 0 && (v == 220 || v == WhisperTokenizer.EOT)) continue
                        val x = buf.get(off + v)
                        if (x > bestV) { bestV = x; best = v }
                    }
                    val next = HashMap<String, OnnxTensor>()
                    for (l in 0 until layers) for (k in KV) {
                        val name = "past_key_values.$l.$k"
                        next[name] = if (cache && k.startsWith("encoder")) past.getValue(name) else r.get("present.$l.$k").get() as OnnxTensor
                    }
                    past = next
                    // Hasil sebelumnya sudah tidak dipakai (masukannya sudah diproses), kecuali hasil pertama.
                    if (first == null) first = r else { prev?.close(); prev = r }
                    if (best < 0 || best == WhisperTokenizer.EOT) break
                    out += best
                    ids = longArrayOf(best.toLong())
                    cache = true
                    // Hentikan pengulangan liar (halusinasi): token sama 4× berturut-turut.
                    if (out.size >= 4 && out.takeLast(4).toSet().size == 1) break
                }
            } finally {
                prev?.close()
                first?.close()
            }
        } finally {
            owned.forEach { it.close() }
        }
        return tokenizer.decode(out)
    }

    override fun close() {
        decoder.close()
        encoder.close()
        opts.close()
    }

    companion object {
        const val ENCODER = "encoder_model_int8.onnx"
        const val DECODER = "decoder_model_merged_int8.onnx"
        const val VOCAB = "vocab.json"
        private const val NO_TIMESTAMPS = 50363
        private val KV = listOf("decoder.key", "decoder.value", "encoder.key", "encoder.value")

        /** <|startoftranscript|> <|id|> <|transcribe|> <|notimestamps|> */
        private val PROMPT = longArrayOf(50258, 50275, 50359, 50363)
        private val SUPPRESS = hashSetOf(
            1, 2, 7, 8, 9, 10, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 359, 503, 522, 542, 873, 893,
            902, 918, 922, 931, 1350, 1853, 1982, 2460, 2627, 3246, 3253, 3268, 3536, 3846, 3961, 4183, 4667, 6585, 6647, 7273,
            9061, 9383, 10428, 10929, 11938, 12033, 12331, 12562, 13793, 14157, 14635, 15265, 15618, 16553, 16604, 18362, 18956,
            20075, 21675, 22520, 26130, 26161, 26435, 28279, 29464, 31650, 32302, 32470, 36865, 42863, 47425, 49870, 50254, 50258,
            50358, 50359, 50360, 50361, 50362,
        )
    }
}
