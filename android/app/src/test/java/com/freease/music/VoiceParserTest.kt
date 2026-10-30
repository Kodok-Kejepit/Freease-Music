package com.freease.music

import com.freease.music.assistant.VoiceCommand
import com.freease.music.assistant.VoiceCommand.*
import com.freease.music.assistant.VoiceParser
import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceParserTest {
    private fun check(text: String, expected: VoiceCommand?) = assertEquals(text, expected, VoiceParser.parse(text))

    @Test
    fun playback() {
        check("lagu berikutnya", Next)
        check("Tolong lagu selanjutnya dong", Next)
        check("skip", Next)
        check("ganti lagunya", Next)
        check("lagu sebelumnya", Previous)
        check("jeda", Pause)
        check("stop musiknya", Pause)
        check("lanjutkan", Resume)
        check("putar lagi", Resume)
        check("suka lagu ini", Like)
        check("tambahkan ke lagu yang disukai", Like)
        check("acak", Shuffle(true))
        check("matikan mode acak", Shuffle(false))
        check("ulangi lagu ini", Repeat)
    }

    @Test
    fun features() {
        check("nyalakan karaoke", Karaoke(true))
        check("mode karaoke", Karaoke(true))
        check("matikan karaoke", Karaoke(false))
        check("tampilkan lirik", ShowLyrics)
        check("lirik", ShowLyrics)
        check("terjemahkan liriknya", TranslateLyrics)
        check("timer tidur 30 menit", SleepTimer(30))
        check("matikan musik dalam satu jam", SleepTimer(60))
        check("tidur empat puluh lima menit lagi", SleepTimer(45))
        check("batalkan timer tidur", CancelSleep)
        check("lagu apa ini", Recognize)
        check("lagu apa yang sedang diputar", WhatsPlaying)
        check("keraskan", Volume(true))
        check("kecilkan volumenya", Volume(false))
        check("kamu bisa apa saja", Help)
    }

    @Test
    fun playingThings() {
        check("putar Tulus", Play("tulus"))
        check("Oke Freease putar hati-hati di jalan", Play("hati-hati di jalan"))
        check("mainkan lagu dari Nadin Amizah", Play("nadin amizah"))
        check("putar lagu-lagu NewJeans", Play("newjeans"))
        check("putar lagu yang disukai", PlayLiked)
        check("putar favoritku", PlayLiked)
        check("putar unduhan", PlayDownloads)
        check("putar daily mix dua", PlayDailyMix(2))
        check("daily mix", PlayDailyMix(1))
        check("putar playlist Galau Akut", PlayPlaylist("galau akut"))
        check("putar evaluasi di freease", Play("evaluasi"))
    }

    @Test
    fun searching() {
        check("cari lagu sedih", Search("lagu sedih"))
        check("carikan bertaut", Search("bertaut"))
        check("hindia evaluasi", Search("hindia evaluasi"))
        check("", null)
        check("tolong dong", null)
    }
}

class VoiceParserWakeTest {
    private fun check(text: String, expected: VoiceCommand?, preferPlay: Boolean = false) =
        assertEquals(text, expected, VoiceParser.parse(text, preferPlay))

    @Test
    fun downloadsAndWakeWords() {
        check("oke freease putar lagu yang sudah di download", PlayDownloads)
        check("Oke freeze, putar lagu yang udah didownload", PlayDownloads)
        check("putar lagu yang diunduh", PlayDownloads)
        check("putar lagu offline", PlayDownloads)
        check("lagu yang sudah di download", PlayDownloads, preferPlay = true)
        check("okay fries lagu berikutnya", Next)
        check("Tulus", Play("tulus"), preferPlay = true)
        check("Tulus", Search("tulus"))
        check("oke freease", null)
    }
}
