package com.freease.music

import com.freease.music.assistant.MoodKind
import com.freease.music.assistant.VoiceCommand
import com.freease.music.assistant.VoiceCommand.*
import com.freease.music.assistant.VoiceParser
import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceContextTest {
    private fun check(text: String, expected: VoiceCommand?) =
        assertEquals(text, expected, VoiceParser.parse(text, preferPlay = true))

    @Test
    fun followUps() {
        check("yang lain dong", More)
        check("oke freease, lagu lain", More)
        check("ganti yang lain", More)
        check("yang tadi lagi", Again)
        check("putar yang tadi", Again)
    }

    @Test
    fun moods() {
        check("putar lagu buat belajar", PlayMood(MoodKind.STUDY))
        check("lagu galau", PlayMood(MoodKind.SAD))
        check("galau dong", PlayMood(MoodKind.SAD))
        check("yang lebih santai", PlayMood(MoodKind.CHILL))
        check("musik untuk olahraga", PlayMood(MoodKind.WORKOUT))
        check("lagu pas lagi nyetir", PlayMood(MoodKind.DRIVE))
        check("putar musik tidur", PlayMood(MoodKind.SLEEP))
        // Judul lagu yang kebetulan memuat kata suasana tetap dicari sebagai lagu.
        check("putar cinta luar biasa", Play("cinta luar biasa"))
        check("putar sedih tak berujung", Play("sedih tak berujung"))
    }

    @Test
    fun summaries() {
        check("aku dengerin apa aja hari ini", Summary(1))
        check("rangkuman minggu ini", Summary(7))
        check("berapa lama aku dengerin musik bulan ini", Summary(30))
    }
}
