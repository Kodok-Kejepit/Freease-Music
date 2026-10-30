package com.freease.music.karaoke

import com.freease.music.data.lyrics.align.Fft
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * FFT kompleks untuk ukuran 2^k atau 3·2^k (mis. 6144 yang dipakai model MDX-Net).
 * Ukuran 3m: tiga FFT radix-2 berukuran m (sampel ke-0,3,6…, ke-1,4,7…, ke-2,5,8…) lalu digabung.
 */
class MixedFft(val n: Int) {
    private val m: Int
    private val radix3: Boolean
    private val sub: Fft
    private val cosT: FloatArray
    private val sinT: FloatArray
    private val aRe: FloatArray; private val aIm: FloatArray
    private val bRe: FloatArray; private val bIm: FloatArray
    private val cRe: FloatArray; private val cIm: FloatArray

    init {
        radix3 = n % 3 == 0
        m = if (radix3) n / 3 else n
        require(m >= 2 && m and (m - 1) == 0) { "Ukuran FFT harus 2^k atau 3·2^k" }
        sub = Fft(m)
        cosT = FloatArray(if (radix3) n else 0) { cos(2 * PI * it / n).toFloat() }
        sinT = FloatArray(if (radix3) n else 0) { sin(2 * PI * it / n).toFloat() }
        val s = if (radix3) m else 0
        aRe = FloatArray(s); aIm = FloatArray(s); bRe = FloatArray(s); bIm = FloatArray(s); cRe = FloatArray(s); cIm = FloatArray(s)
    }

    /** FFT maju di tempat (tanpa normalisasi). */
    fun forward(re: FloatArray, im: FloatArray) {
        if (!radix3) {
            sub.transform(re, im)
            return
        }
        for (j in 0 until m) {
            aRe[j] = re[3 * j]; aIm[j] = im[3 * j]
            bRe[j] = re[3 * j + 1]; bIm[j] = im[3 * j + 1]
            cRe[j] = re[3 * j + 2]; cIm[j] = im[3 * j + 2]
        }
        sub.transform(aRe, aIm)
        sub.transform(bRe, bIm)
        sub.transform(cRe, cIm)
        for (k in 0 until n) {
            val j = k % m
            // W^k = e^{-2πik/n}, W^{2k}
            val c1 = cosT[k]; val s1 = sinT[k]
            val k2 = (2 * k) % n
            val c2 = cosT[k2]; val s2 = sinT[k2]
            val br = bRe[j] * c1 + bIm[j] * s1
            val bi = bIm[j] * c1 - bRe[j] * s1
            val cr = cRe[j] * c2 + cIm[j] * s2
            val ci = cIm[j] * c2 - cRe[j] * s2
            re[k] = aRe[j] + br + cr
            im[k] = aIm[j] + bi + ci
        }
    }

    /** FFT terbalik di tempat, sudah dibagi n. */
    fun inverse(re: FloatArray, im: FloatArray) {
        for (i in 0 until n) im[i] = -im[i]
        forward(re, im)
        val inv = 1f / n
        for (i in 0 until n) {
            re[i] *= inv
            im[i] = -im[i] * inv
        }
    }
}
