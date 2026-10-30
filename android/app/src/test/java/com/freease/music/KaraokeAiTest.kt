package com.freease.music

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.freease.music.karaoke.MdxModel
import com.freease.music.karaoke.MdxSeparator
import com.freease.music.karaoke.MixedFft
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin
import kotlin.random.Random

class KaraokeAiTest {
    @Test
    fun semitones() {
        val sp = com.freease.music.playback.SongParams
        assertEquals(0, sp.semitones(1f))
        assertEquals(2, sp.semitones(sp.pitchOf(2)))
        assertEquals(-3, sp.semitones(sp.pitchOf(-3)))
        assertEquals(2f, sp.pitchOf(12), 0.001f)
    }

    @Test
    fun wavHeader() {
        val h = com.freease.music.karaoke.KaraokeEngine.wavHeader(48_000, 48_000)
        val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(h, 0, 4))
        assertEquals(36 + 48_000 * 4, b.getInt(4))
        assertEquals(48_000, b.getInt(24))
        assertEquals(48_000 * 4, b.getInt(40))
    }
    @Test
    fun fft6144MatchesDft() {
        val n = 6144
        val rnd = Random(3)
        val xr = FloatArray(n) { rnd.nextFloat() - 0.5f }
        val xi = FloatArray(n) { rnd.nextFloat() - 0.5f }
        val re = xr.copyOf(); val im = xi.copyOf()
        MixedFft(n).forward(re, im)
        for (k in listOf(0, 1, 7, 1000, 2047, 2048, 3072, 4097, 6143)) {
            var sr = 0.0; var si = 0.0
            for (j in 0 until n) {
                val a = -2 * PI * k.toLong() * j / n
                sr += xr[j] * cos(a) - xi[j] * sin(a)
                si += xr[j] * sin(a) + xi[j] * cos(a)
            }
            assertEquals("re[$k]", sr, re[k].toDouble(), 2e-2)
            assertEquals("im[$k]", si, im[k].toDouble(), 2e-2)
        }
        MixedFft(n).inverse(re, im)
        for (j in 0 until n step 97) assertEquals(xr[j], re[j], 1e-4f)
    }

    /** Model "identitas": STFT → ISTFT → potongan bertahap harus mengembalikan sinyal aslinya. */
    @Test
    fun identityRoundTrip() {
        val model = MdxModel.BEST.copy(compensate = 1f)
        val sep = MdxSeparator(model) { x, y -> x.copyInto(y) }
        val frames = 700_000 // ±16 dtk, beberapa potongan + sisa
        val rnd = Random(5)
        val src = FloatArray(frames * 2) { i -> (0.3 * sin(2 * PI * 440 * (i / 2) / 44100.0) + 0.1 * (rnd.nextFloat() - 0.5)).toFloat() }
        val out = FloatArray(frames * 2)
        var r = 0
        var w = 0
        sep.separate(
            read = { buf, max -> val n = minOf(max, frames - r); System.arraycopy(src, r * 2, buf, 0, n * 2); r += n; n },
            write = { buf, n -> System.arraycopy(buf, 0, out, w * 2, n * 2); w += n },
        )
        assertEquals(frames, w)
        var err = 0.0; var sig = 0.0
        for (i in src.indices) { err += (out[i] - src[i]).let { it * it.toDouble() }; sig += src[i] * src[i].toDouble() }
        val snr = 10 * log10(sig / err)
        println("identitas SNR ${"%.1f".format(snr)} dB")
        assertTrue("SNR $snr", snr > 50) // batas presisi float32
    }

    /**
     * Model AI sungguhan (opsional): -Pkaraoke.models=DIR berisi berkas .onnx, -Pkaraoke.mix=DIR berisi
     * mus1.pcm (musik stereo) & vox1.pcm (vokal mono). Hasilnya harus sama dengan referensi Python (±16 dB).
     */
    @Test
    fun realModel() {
        val dir = System.getProperty("karaoke.models")
        val mix = System.getProperty("karaoke.mix")
        Assume.assumeTrue(dir != null && mix != null)
        fun read(f: File): FloatArray {
            val sb = ByteBuffer.wrap(f.readBytes()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            return FloatArray(sb.remaining()) { sb.get(it) / 32768f }
        }
        val mus = read(File(mix, "mus1.pcm"))
        val vox = read(File(mix, "vox1.pcm"))
        val frames = minOf(mus.size / 2, vox.size)
        var em = 0.0; var ev = 0.0
        for (i in 0 until frames) { em += mus[2 * i] * mus[2 * i].toDouble() + mus[2 * i + 1] * mus[2 * i + 1]; ev += 2.0 * vox[i] * vox[i] }
        val g = (kotlin.math.sqrt(em / ev) * 1.2).toFloat()
        val input = FloatArray(frames * 2) { i -> mus[i] + vox[i / 2] * g }
        val env = OrtEnvironment.getEnvironment()
        for (model in MdxModel.ALL) {
            val file = File(dir, model.fileName)
            if (!file.exists()) continue
            val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(4); setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT) }
            env.createSession(file.path, opts).use { session ->
                val shape = longArrayOf(1, 4, model.dimF.toLong(), model.dimT.toLong())
                var inferNs = 0L
                val direct = java.nio.ByteBuffer.allocateDirect(4 * model.dimF * model.dimT * 4).order(java.nio.ByteOrder.nativeOrder()).asFloatBuffer()
                val sep = MdxSeparator(model) { x, y ->
                    val t0i = System.nanoTime()
                    direct.clear(); direct.put(x); direct.rewind()
                    OnnxTensor.createTensor(env, direct, shape).use { t ->
                        session.run(mapOf(session.inputNames.first() to t)).use { r -> (r[0] as OnnxTensor).floatBuffer.get(y) }
                    }
                    inferNs += System.nanoTime() - t0i
                }
                val out = FloatArray(frames * 2)
                var rd = 0; var w = 0
                val t0 = System.currentTimeMillis()
                sep.separate(
                    read = { buf, max -> val n = minOf(max, frames - rd); System.arraycopy(input, rd * 2, buf, 0, n * 2); rd += n; n },
                    write = { buf, n -> System.arraycopy(buf, 0, out, w * 2, n * 2); w += n },
                )
                val sec = (System.currentTimeMillis() - t0) / 1000.0
                val a = 6144 * 2; val b = frames * 2 - 6144 * 2
                var s = 0.0; var e = 0.0
                for (i in a until b) { s += mus[i] * mus[i].toDouble(); e += (out[i] - mus[i]).let { it * it.toDouble() } }
                val sdr = 10 * log10(s / e)
                println("MODEL ${model.id}: model ${"%.1f".format(inferNs / 1e9)} dtk dari ${"%.1f".format(sec)} dtk total")
                println("MODEL ${model.id}: SDR ${"%.1f".format(sdr)} dB, ${"%.1f".format(sec / (frames / 44100.0) * 60)} dtk per menit lagu")
                assertTrue("SDR ${model.id} $sdr", sdr > 12)
            }
        }
    }
}
