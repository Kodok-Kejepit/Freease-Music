package com.freease.music

import com.freease.music.data.lyrics.LyricsTranslator
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

class TranslatorTest {
    @Test
    fun parseResponse() {
        val json = """[[["aku mencintaimu\n","사랑해\n",null,null,3],["Aku akan selalu mencintaimu","I will always love you",null,null,3]],null,"ko",null,null,null,1]"""
        val (text, src) = LyricsTranslator.parse(json)
        assertEquals("aku mencintaimu\nAku akan selalu mencintaimu", text)
        assertEquals("ko", src)
    }

    @Test
    fun skipsNonText() {
        assertFalse(LyricsTranslator.needsTranslation("♪"))
        assertFalse(LyricsTranslator.needsTranslation("  "))
        assertFalse(LyricsTranslator.needsTranslation("1, 2, 3!"))
        assertTrue(LyricsTranslator.needsTranslation("Kissy face"))
    }

    /** Terjemahan sungguhan (opsional, butuh internet): berkas `translate.on` di folder app. */
    @Test
    fun realTranslation() = runBlocking {
        Assume.assumeTrue(File("translate.on").exists())
        val dir = File(System.getProperty("java.io.tmpdir"), "tr_test").apply { deleteRecursively() }
        val t = LyricsTranslator(OkHttpClient(), dir)
        val lines = listOf("사랑해 너를 원해", "♪", "I will always love you", "", "Kissy face, kissy face")
        val r = t.translate("kor1", lines)
        println("TR src=${r.sourceLang} -> ${r.lines}")
        assertEquals(lines.size, r.lines.size)
        assertNull(r.lines[1]); assertNull(r.lines[3])
        assertTrue(r.lines[2]!!.lowercase().contains("cinta"))
        val indo = t.translate("indo1", listOf("Hati-hati di jalan", "Kau tak sanggup"))
        println("TR indo src=${indo.sourceLang} -> ${indo.lines}")
        assertTrue(indo.alreadyTarget)
        // Kedua kalinya dari cache berkas (tanpa jaringan).
        val again = LyricsTranslator(OkHttpClient.Builder().addInterceptor { error("tidak boleh ke jaringan") }.build(), dir).translate("kor1", lines)
        assertEquals(r.lines, again.lines)
    }
}

class AudioInfoTest {
    @Test
    fun codecNames() {
        val f = com.freease.music.playback.AudioInfo.Companion
        assertEquals("Opus", f.codecName("audio/opus", null))
        assertEquals("AAC", f.codecName("audio/mp4a-latm", "mp4a.40.2"))
        assertEquals("MP3", f.codecName("audio/mpeg", null))
        assertEquals("FLAC", f.codecName("audio/flac", null))
        assertEquals("PCM (WAV)", f.codecName("audio/raw", null))
        assertEquals("mp4a.40.2", f.codecName(null, "mp4a.40.2"))
    }
}
