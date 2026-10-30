package com.freease.music

import com.freease.music.karaoke.Pitch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class PitchTest {
    private fun tone(hz: Double, rate: Int, n: Int, harmonics: Boolean = true) = FloatArray(n) {
        val t = it.toDouble() / rate
        (0.5 * sin(2 * PI * hz * t) + if (harmonics) 0.25 * sin(2 * PI * 2 * hz * t) + 0.12 * sin(2 * PI * 3 * hz * t) else 0.0).toFloat()
    }

    @Test
    fun detectsVoiceRange() {
        for (hz in listOf(98.0, 196.0, 261.6, 440.0, 660.0)) {
            for (rate in listOf(16_000, 44_100, 48_000)) {
                val f = Pitch.yin(tone(hz, rate, 2048), 2048, rate)
                assertEquals("$hz Hz @ $rate", hz, f.toDouble(), hz * 0.02)
            }
        }
    }

    @Test
    fun silenceAndNoiseHaveNoPitch() {
        assertEquals(0f, Pitch.yin(FloatArray(2048), 2048, 44_100))
        val r = java.util.Random(1)
        val noise = FloatArray(2048) { (r.nextGaussian() * 0.3).toFloat() }
        assertEquals(0f, Pitch.yin(noise, 2048, 44_100))
    }

    @Test
    fun octaveFoldingAndScore() {
        assertEquals(0f, Pitch.semitoneDiff(220f, 440f), 0.01f) // satu oktaf di bawah = pas
        assertEquals(1f, Pitch.semitoneDiff(466.16f, 440f), 0.02f)
        assertTrue(Pitch.semitoneDiff(0f, 440f).isNaN())
        assertEquals(1f, Pitch.frameScore(0.4f))
        assertEquals(0f, Pitch.frameScore(5f))
    }
}
