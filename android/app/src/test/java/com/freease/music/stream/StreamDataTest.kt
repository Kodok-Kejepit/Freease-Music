package com.freease.music.stream

import com.freease.music.stream.data.Chapter
import com.freease.music.stream.data.Img
import com.freease.music.stream.data.Resolvers
import com.freease.music.stream.data.Saved
import com.freease.music.stream.data.Seen
import com.freease.music.stream.data.StreamData
import com.freease.music.stream.data.StreamStore
import com.freease.music.stream.data.VideoSource
import com.freease.music.stream.data.htmlLine
import com.freease.music.stream.data.sameTitle
import com.freease.music.stream.data.tidyChapters
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamDataTest {
    @Test fun koleksiDanProgresBolakBalikTanpaKehilanganData() {
        val d = StreamData(
            favs = listOf(Saved("anime", "od:abc", "Judul", Img("https://x/y.jpg", "https://x/"), "TV")),
            recent = listOf(Saved("manga", "km:a", "Komik", null, null, "km:/a-1/", "Chapter 1", 3, 20)),
            seen = mapOf("km:/a-1/" to Seen(3, 20, 99)),
        )
        val back = StreamStore.decode(JSONObject(StreamStore.encode(d).toString()))
        assertEquals(d.favs.first().copy(updated = 0), back.favs.first().copy(updated = 0))
        assertEquals("km:/a-1/", back.recent.first().itemId)
        assertEquals(Seen(3, 20, 99), back.seen["km:/a-1/"])
    }

    @Test fun embedHanyaUntukHostYangDiuji() {
        assertTrue(Resolvers.embed("https://player.abyssplayer.com/x").single().embed)
        assertEquals("MEGA", Resolvers.embed("https://mega.nz/embed/abc#k").single().label)
        assertTrue(Resolvers.embed("https://morencius.com/embed/x").isEmpty())
        assertTrue(Resolvers.embed("http://player.abyssplayer.com/x").isEmpty())
        assertTrue(Resolvers.embed("https://mega.nz/file/abc").isEmpty())
    }

    @Test fun berkasLangsungDidahulukanLaluKualitasTertinggi() {
        val out = Resolvers.sort(listOf(VideoSource("A", "Auto", "e", embed = true), VideoSource("B", "360p", "b"), VideoSource("C", "1080p", "c")))
        assertEquals(listOf("1080p", "360p", "Auto"), out.map { it.quality })
    }

    @Test fun babBernomorSamaCukupSatuDanUrutNaik() {
        val out = tidyChapters(listOf(Chapter("2", "2", null, 1), Chapter("1", "1", null), Chapter("2b", "2", null, 5), Chapter("x", null, "Extra")))
        assertEquals(listOf("1", "2b", "x"), out.map { it.id })
    }

    @Test fun judulDanHtml() {
        assertTrue(sameTitle("Mu Shen Ji", "Mushen Ji!"))
        assertFalse(sameTitle("", "x"))
        assertEquals("Tom & Jerry “Lucu”", htmlLine("<b>Tom &amp; Jerry</b>\n &ldquo;Lucu&rdquo;"))
    }
}
