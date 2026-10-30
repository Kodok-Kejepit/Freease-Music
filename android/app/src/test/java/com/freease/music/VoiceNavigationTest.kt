package com.freease.music

import com.freease.music.assistant.Page
import com.freease.music.assistant.VoiceCommand
import com.freease.music.assistant.VoiceCommand.*
import com.freease.music.assistant.VoiceParser
import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceNavigationTest {
    private fun check(text: String, expected: VoiceCommand?, wake: Boolean = true) =
        assertEquals(text, expected, VoiceParser.parse(text, preferPlay = wake))

    @Test
    fun opensPages() {
        check("oke freease, pergi ke beranda", Open(Page.HOME))
        check("Oke freeze buka beranda", Open(Page.HOME))
        check("ke halaman utama", Open(Page.HOME))
        check("beranda", Open(Page.HOME))
        check("oke fries buka koleksi", Open(Page.LIBRARY))
        check("pergi ke koleksi saya", Open(Page.LIBRARY))
        check("buka pencarian", Open(Page.SEARCH))
        check("buka hasil download", Open(Page.DOWNLOADS))
        check("buka lagu yang sudah di download", Open(Page.DOWNLOADS))
        check("pergi ke unduhan", Open(Page.DOWNLOADS))
        check("buka rekap bulanan", Open(Page.MONTHLY))
        check("lihat monthly freease", Open(Page.MONTHLY))
        check("buka rekap tahunan", OpenWrapped(null))
        check("buka wrapped 2025", OpenWrapped(2025))
        check("buka lagu yang disukai", Open(Page.LIKED))
        check("buka karaoke tersimpan", Open(Page.KARAOKE_SAVED))
        check("buka lagu karaoke yang sudah di download", Open(Page.KARAOKE_SAVED))
        check("buka musik di hp", Open(Page.LOCAL_MUSIC))
        check("buka video di hp", Open(Page.LOCAL_MUSIC))
        check("buka riwayat", Open(Page.HISTORY))
        check("lihat statistik", Open(Page.STATS))
        check("buka pengaturan", Open(Page.SETTINGS))
        check("buka equalizer", Open(Page.EQUALIZER))
        check("buka alarm", Open(Page.ALARMS))
        check("masuk ke mode mobil", Open(Page.CAR))
        check("buka kenali lagu", Open(Page.RECOGNIZE))
        check("buka impor playlist", Open(Page.IMPORT))
        check("buka suara dev", Open(Page.VOICE_PACK))
        check("lihat antrean", Open(Page.QUEUE))
        check("buka pemutar", Open(Page.PLAYER))
        check("buka playlist santai sore", OpenPlaylist("santai sore"))
        check("buka daily mix 2", OpenDailyMix(2))
        check("buka artis tulus", OpenArtist("tulus"))
        check("kembali", Back)
    }

    @Test
    fun keepsOtherCommands() {
        check("oke freease, putar lagu yang sudah di download", PlayDownloads)
        check("nyalakan karaoke", Karaoke(true))
        check("karaoke", Karaoke(true))
        check("buka lirik", ShowLyrics)
        check("kembali ke lagu sebelumnya", Previous)
        check("cari tulus", Search("tulus"))
        check("putar playlist santai", PlayPlaylist("santai"))
        check("lagu berikutnya", Next)
        check("tulus", Play("tulus"))
        check("tambahkan ke disukai", Like)
    }
}
