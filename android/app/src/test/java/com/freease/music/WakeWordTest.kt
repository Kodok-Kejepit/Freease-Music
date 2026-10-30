package com.freease.music

import com.freease.music.assistant.WakeWordDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WakeWordTest {
    @Test
    fun detectsWakePhrase() {
        assertTrue(WakeWordDetector.isWake("okay freeze"))
        assertTrue(WakeWordDetector.isWake("OK FRIES"))
        assertTrue(WakeWordDetector.isWake("[unk] okay freeze [unk]"))
        assertFalse(WakeWordDetector.isWake("okay"))
        assertFalse(WakeWordDetector.isWake("[unk]"))
        assertFalse(WakeWordDetector.isWake(""))
    }

    @Test
    fun readsVoskJson() {
        assertEquals("okay freeze", WakeWordDetector.textOf("""{"text" : "okay freeze"}"""))
        assertEquals("ok fries", WakeWordDetector.textOf("""{"partial" : "ok fries"}"""))
        assertEquals("", WakeWordDetector.textOf("bukan json"))
    }

    @Test
    fun grammarIncludesUnknown() {
        assertTrue(WakeWordDetector.GRAMMAR.contains("[unk]"))
        assertTrue(WakeWordDetector.GRAMMAR.startsWith("["))
    }
}
