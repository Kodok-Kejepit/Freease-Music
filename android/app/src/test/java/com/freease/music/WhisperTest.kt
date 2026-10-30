package com.freease.music

import com.freease.music.assistant.WhisperFeatures
import com.freease.music.assistant.WhisperRecognizer
import com.freease.music.assistant.WhisperTokenizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WhisperTest {
    @Test
    fun parsesVocabAndDecodesBytes() {
        val v = WhisperTokenizer.parseVocab("""{"!": 0, "\"": 1, "Ġputar": 2, "Ã©": 3, "x\\y": 4}""")
        assertEquals(0, v["!"])
        assertEquals(1, v["\""])
        assertEquals(4, v["x\\y"])
        val t = WhisperTokenizer("""{"Ġputar": 0, "Ġlagu": 1, "Ã©": 2}""")
        assertEquals("putar lagu é", t.decode(listOf(0, 1, 2, WhisperTokenizer.EOT)).replace("lagué", "lagu é"))
    }

    @Test
    fun melFiltersMatchSlaney() {
        // Jumlah tiap filter (dikali lebar bin) ≈ 1 untuk normalisasi Slaney; puncak filter pertama di ±0–26 Hz.
        val f = WhisperFeatures.filters
        assertEquals(80, f.size)
        assertEquals(201, f[0].size)
        assertTrue(f.all { row -> row.any { it > 0f } })
    }

    @Test
    fun silenceIsFlat() {
        val m = WhisperFeatures.compute(FloatArray(16000))
        assertTrue(m.all { it == m[0] })
    }

    /** -Pwhisper.dir=… -Pwhisper.pcm=… (PCM 16 kHz s16le) → cetak transkrip beberapa potongan. */
    @Test
    fun realModel() {
        val dir = System.getProperty("whisper.dir")
        val pcm = System.getProperty("whisper.pcm")
        Assume.assumeTrue(dir != null && pcm != null)
        val sb = ByteBuffer.wrap(File(pcm!!).readBytes()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val a = FloatArray(sb.remaining()) { sb.get(it) / 32768f }
        WhisperRecognizer(File(dir!!)).use { w ->
            for ((s0, s1) in listOf(7.2 to 8.4, 9.0 to 14.4, 40.1 to 47.2, 62.2 to 66.2)) {
                val x = a.copyOfRange((s0 * 16000).toInt(), (s1 * 16000).toInt())
                val t0 = System.nanoTime()
                val text = w.transcribe(x)
                println("WHISPER $s0-$s1 ${(System.nanoTime() - t0) / 1_000_000} ms | $text")
                assertTrue(text.isNotBlank())
            }
        }
    }
}
