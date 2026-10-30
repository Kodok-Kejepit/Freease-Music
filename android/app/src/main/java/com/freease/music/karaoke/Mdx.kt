package com.freease.music.karaoke

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sqrt

/** Model pemisah vokal MDX-Net (dari proyek Ultimate Vocal Remover) beserta parameter STFT-nya. */
data class MdxModel(
    val id: String,
    val label: String,
    val description: String,
    val fileName: String,
    val sizeBytes: Long,
    /** SHA-256 berkas model — dicek setelah unduh/impor supaya berkas rusak tidak pernah dipakai. */
    val sha256: String,
    val nFft: Int,
    val dimF: Int,
    val dimT: Int = 256,
    val hop: Int = 1024,
    /** true = model mengeluarkan vokal (instrumen = campuran − vokal); false = langsung instrumen. */
    val outputsVocals: Boolean,
    /** Koreksi level keluaran model (diukur pada campuran uji). */
    val compensate: Float,
) {
    /**
     * Sumber unduhan, dicoba berurutan. Berkasnya identik (SHA-256 sama); beberapa jalur disiapkan karena
     * sebagian operator (mis. di Indonesia) memblokir huggingface.co.
     */
    val urls: List<String> get() = listOf(
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/$fileName",
        "https://hf-mirror.com/seanghay/uvr_models/resolve/main/$fileName",
        "https://huggingface.co/seanghay/uvr_models/resolve/main/$fileName",
    )

    val spec: DownloadSpec get() = DownloadSpec(fileName, sizeBytes, sha256, urls)

    val chunk: Int get() = hop * (dimT - 1)
    val trim: Int get() = nFft / 2
    val gen: Int get() = chunk - 2 * trim

    companion object {
        val BEST = MdxModel(
            "hq3", "Terbaik", "Semua vokal dihilangkan, paling bersih. Butuh HP yang cukup kencang.",
            "UVR-MDX-NET-Inst_HQ_3.onnx", 66_759_214, "317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc",
            nFft = 6144, dimF = 3072, outputsVocals = false, compensate = 1.028f,
        )
        val FAST = MdxModel(
            "kara", "Cepat", "Penyanyi utama dihilangkan, backing vokal tetap ada. ±2,5× lebih cepat.",
            "UVR_MDXNET_KARA.onnx", 29_704_436, "e3167c87333a48548413e972a286bf40bf5694001d2853861eb1435953f02d63",
            nFft = 6144, dimF = 2048, outputsVocals = true, compensate = 1.047f,
        )
        val ALL = listOf(BEST, FAST)
        fun byId(id: String?) = ALL.firstOrNull { it.id == id } ?: BEST
    }
}

/**
 * Pemisahan vokal bertahap, persis seperti UVR: audio dipotong per [MdxModel.chunk] sampel dengan
 * tumpang-tindih [MdxModel.trim] di tiap sisi, tiap potongan diubah ke spektrum (STFT, jendela Hann),
 * dijalankan lewat model, lalu dikembalikan ke gelombang (ISTFT). Hanya bagian tengah tiap potongan
 * ([MdxModel.gen] sampel) yang dipakai sehingga sambungan antar-potongan mulus.
 *
 * [infer] menjalankan model: masukan → keluaran, keduanya berbentuk [1, 4, dimF, dimT] (L.re, L.im, R.re, R.im).
 * Larik keluaran disediakan pemanggil dan dipakai ulang tiap potongan (tanpa alokasi ±12 MB per potongan).
 */
class MdxSeparator(private val model: MdxModel, private val infer: (input: FloatArray, output: FloatArray) -> Unit) {
    private val nFft = model.nFft
    private val hop = model.hop
    private val dimF = model.dimF
    private val dimT = model.dimT
    private val chunk = model.chunk
    private val pad = nFft / 2
    private val fft = MixedFft(nFft)
    private val win = FloatArray(nFft) { (0.5 - 0.5 * cos(2 * PI * it / nFft)).toFloat() } // Hann periodik
    private val re = FloatArray(nFft)
    private val im = FloatArray(nFft)

    /** Pembagi ISTFT (jumlah kuadrat jendela) — sama untuk semua potongan. */
    private val norm: FloatArray = FloatArray(chunk + 2 * pad).also { a ->
        for (t in 0 until dimT) for (k in 0 until nFft) a[t * hop + k] += win[k] * win[k]
    }

    private val padded = FloatArray((chunk + 2 * pad) * 2)
    private val input = FloatArray(4 * dimF * dimT)
    private val y = FloatArray(4 * dimF * dimT)
    private val olaL = FloatArray(chunk + 2 * pad)
    private val olaR = FloatArray(chunk + 2 * pad)

    /**
     * Pisahkan satu potongan [window] (stereo berselang-seling, panjang [MdxModel.chunk] frame) dan
     * tulis instrumen untuk bagian tengahnya (frame [trim, trim+gen)) ke [out] (panjang gen×2).
     */
    fun processChunk(window: FloatArray, out: FloatArray) {
        // Pantulan di kedua tepi (seperti torch.stft center=True, mode "reflect").
        val total = chunk + 2 * pad
        for (i in 0 until total) {
            var s = i - pad
            if (s < 0) s = -s
            if (s >= chunk) s = 2 * (chunk - 1) - s
            padded[2 * i] = window[2 * s]
            padded[2 * i + 1] = window[2 * s + 1]
        }
        // STFT: kiri & kanan sekaligus dalam satu FFT kompleks (L + iR).
        val plane = dimF * dimT
        for (t in 0 until dimT) {
            val off = t * hop
            for (k in 0 until nFft) {
                re[k] = padded[2 * (off + k)] * win[k]
                im[k] = padded[2 * (off + k) + 1] * win[k]
            }
            fft.forward(re, im)
            for (f in 0 until dimF) {
                val g = if (f == 0) 0 else nFft - f
                val zr = re[f]; val zi = im[f]
                val cr = re[g]; val ci = -im[g] // konjugat Z[n−f]
                // L = (Z + conj Z[n−f]) / 2 ;  R = (Z − conj Z[n−f]) / 2i
                val lr = (zr + cr) * 0.5f; val li = (zi + ci) * 0.5f
                val rr = (zi - ci) * 0.5f; val ri = -(zr - cr) * 0.5f
                val idx = f * dimT + t
                input[idx] = lr
                input[plane + idx] = li
                input[2 * plane + idx] = rr
                input[3 * plane + idx] = ri
            }
        }

        infer(input, y)

        // ISTFT: L + iR → satu FFT terbalik menghasilkan dua sinyal riil.
        java.util.Arrays.fill(olaL, 0f)
        java.util.Arrays.fill(olaR, 0f)
        for (t in 0 until dimT) {
            java.util.Arrays.fill(re, 0f)
            java.util.Arrays.fill(im, 0f)
            for (f in 0 until dimF) {
                val idx = f * dimT + t
                val lr = y[idx]; val li = y[plane + idx]
                val rr = y[2 * plane + idx]; val ri = y[3 * plane + idx]
                // Z[f] = L + iR ; Z[n−f] = conj(L) + i·conj(R)
                re[f] = lr - ri
                im[f] = li + rr
                if (f in 1 until nFft / 2) {
                    re[nFft - f] = lr + ri
                    im[nFft - f] = -li + rr
                }
            }
            fft.inverse(re, im)
            val off = t * hop
            for (k in 0 until nFft) {
                olaL[off + k] += re[k] * win[k]
                olaR[off + k] += im[k] * win[k]
            }
        }
        val trim = model.trim
        val gen = model.gen
        val comp = model.compensate
        for (i in 0 until gen) {
            val p = pad + trim + i
            val n = norm[p].coerceAtLeast(1e-8f)
            val l = olaL[p] / n * comp
            val r = olaR[p] / n * comp
            if (model.outputsVocals) {
                out[2 * i] = window[2 * (trim + i)] - l
                out[2 * i + 1] = window[2 * (trim + i) + 1] - r
            } else {
                out[2 * i] = l
                out[2 * i + 1] = r
            }
        }
    }

    /**
     * Proses seluruh lagu secara bertahap. [read] mengisi buffer stereo dan mengembalikan jumlah frame
     * (0 = habis); [write] menerima hasil instrumen (stereo) — jumlah total frame = masukan.
     * [onProgress] dipanggil dengan jumlah frame yang sudah dihasilkan.
     */
    fun separate(read: (FloatArray, Int) -> Int, write: (FloatArray, Int) -> Unit, isActive: () -> Boolean = { true }) {
        val trim = model.trim
        val gen = model.gen
        val window = FloatArray(chunk * 2)
        val out = FloatArray(gen * 2)
        val tmp = FloatArray(gen * 2)
        // Awal: trim frame nol, lalu chunk−trim frame pertama lagu.
        var have = trim
        var ended = false
        var pendingFrames = 0L // frame lagu yang sudah dibaca tapi belum dikeluarkan
        fun fill(target: Int) {
            while (have < target) {
                val want = target - have
                val n = if (ended) 0 else read(tmp, minOf(want, gen))
                if (n <= 0) {
                    ended = true
                    java.util.Arrays.fill(window, have * 2, target * 2, 0f)
                    have = target
                } else {
                    System.arraycopy(tmp, 0, window, have * 2, n * 2)
                    have += n
                    pendingFrames += n
                }
            }
        }
        fill(chunk)
        while (pendingFrames > 0) {
            if (!isActive()) throw java.io.IOException("Dibatalkan")
            processChunk(window, out)
            val emit = minOf(gen.toLong(), pendingFrames).toInt()
            write(out, emit)
            pendingFrames -= emit
            // Geser jendela sebanyak gen frame.
            System.arraycopy(window, gen * 2, window, 0, (chunk - gen) * 2)
            have = chunk - gen
            fill(chunk)
        }
    }

    companion object {
        /** RMS sederhana untuk uji. */
        fun rms(a: FloatArray): Double = sqrt(a.fold(0.0) { s, x -> s + x * x } / a.size)
    }
}
