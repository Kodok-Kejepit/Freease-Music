package com.freease.music.karaoke

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.roundToInt

/** Deteksi nada (frekuensi dasar) dengan algoritma YIN — cukup ringan untuk 10×/detik di HP. */
object Pitch {
    /**
     * @return frekuensi (Hz) atau 0 kalau tidak ada nada yang jelas (hening/derau).
     * [x] mono −1..1, [n] jumlah sampel yang dipakai, rentang suara manusia 70–1000 Hz.
     */
    fun yin(x: FloatArray, n: Int, rate: Int, threshold: Float = 0.15f, minHz: Float = 70f, maxHz: Float = 1000f): Float {
        val tauMin = (rate / maxHz).toInt().coerceAtLeast(2)
        val tauMax = (rate / minHz).toInt().coerceAtMost(n / 2)
        if (tauMax <= tauMin + 2) return 0f
        // Terlalu pelan → anggap tidak bernyanyi.
        var energy = 0f
        for (i in 0 until n) energy += x[i] * x[i]
        if (energy / n < 1e-5f) return 0f
        val w = n - tauMax
        val d = FloatArray(tauMax + 1)
        for (tau in 1..tauMax) {
            var sum = 0f
            for (i in 0 until w) {
                val diff = x[i] - x[i + tau]
                sum += diff * diff
            }
            d[tau] = sum
        }
        // Selisih ternormalisasi kumulatif.
        var running = 0f
        val cmnd = FloatArray(tauMax + 1)
        cmnd[0] = 1f
        for (tau in 1..tauMax) {
            running += d[tau]
            cmnd[tau] = if (running == 0f) 1f else d[tau] * tau / running
        }
        var tau = tauMin
        while (tau <= tauMax) {
            if (cmnd[tau] < threshold) {
                while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++
                break
            }
            tau++
        }
        if (tau > tauMax) return 0f
        // Interpolasi parabola untuk ketelitian sub-sampel.
        val better = if (tau in 1 until tauMax) {
            val a = cmnd[tau - 1]; val b = cmnd[tau]; val c = cmnd[tau + 1]
            val den = a + c - 2 * b
            if (abs(den) > 1e-9f) tau + (a - c) / (2 * den) else tau.toFloat()
        } else tau.toFloat()
        return rate / better
    }

    /** Selisih dua nada dalam semitone, dilipat ke oktaf terdekat (−6..6): nyanyi satu oktaf lebih rendah tetap dihitung pas. */
    fun semitoneDiff(sung: Float, target: Float): Float {
        if (sung <= 0f || target <= 0f) return Float.NaN
        var d = (12.0 * ln(sung / target.toDouble()) / ln(2.0)).toFloat()
        d -= 12f * (d / 12f).roundToInt()
        return d
    }

    /** Nilai satu cuplikan (0..1) dari selisih semitone. */
    fun frameScore(diff: Float): Float = when {
        diff.isNaN() -> 0f
        abs(diff) <= 1f -> 1f
        abs(diff) <= 2f -> 0.6f
        abs(diff) <= 3f -> 0.3f
        else -> 0f
    }
}
