package com.freease.music.stream

import com.freease.music.stream.data.StreamRepository
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.zip.GZIPInputStream

/** Parser Otakudesu & Anichin atas halaman asli yang disimpan (situsnya menolak IP pusat data seperti mesin CI). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StreamParserTest {
    private fun res(path: String): String? = javaClass.getResourceAsStream("/stream/$path")?.use { s -> if (path.endsWith(".gz")) GZIPInputStream(s).reader().readText() else s.reader().readText() }
    private val od = res("od/ids.txt")!!.trim().split(" ")
    private val ac = res("ac/ids.txt")!!.trim().split(" ")

    private fun fixture(host: String, path: String, query: String?): String? = when (host) {
        "otakudesu.blog" -> when {
            path == "/ongoing-anime/" -> "od/ongoing.html.gz"
            path == "/complete-anime/" -> "od/complete.html.gz"
            path == "/jadwal-rilis/" -> "od/jadwal.html.gz"
            path == "/genre-list/" -> "od/genres.html.gz"
            path == "/" && query?.contains("s=") == true -> "od/search.html.gz"
            path == "/anime/${od[0]}/" -> "od/detail.html.gz"
            path == "/episode/${od[1]}/" -> "od/episode.html.gz"
            else -> null
        }
        "anichin.moe" -> when {
            path == "/" && query?.contains("s=") == true -> "ac/search.html.gz"
            path == "/" -> "ac/home.html.gz"
            path == "/anime/" -> "ac/list.html.gz"
            path == "/schedule/" -> "ac/schedule.html.gz"
            path == "/${ac[0]}/" -> "ac/detail.html.gz"
            path == "/${ac[1]}/" -> "ac/episode.html.gz"
            else -> null
        }
        else -> null
    }

    private val repo = StreamRepository(OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
        val u = chain.request().url
        val body = fixture(u.host, u.encodedPath, u.query)?.let(::res)
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(if (body != null) 200 else 404).message("x")
            .body((body ?: "").toResponseBody("text/html".toMediaType())).build()
    }).build())

    @Test fun otakudesu() = runBlocking {
        val ongoing = repo.od.list(false)
        assertTrue("ongoing ${ongoing.items.size}", ongoing.items.size >= 10)
        assertTrue(ongoing.items.all { it.id.startsWith("od:") && it.title.isNotBlank() && it.cover != null && !it.episode.isNullOrEmpty() })
        assertTrue(repo.od.list(true).items.isNotEmpty())
        assertTrue(repo.od.search("one piece").isNotEmpty())
        assertTrue(repo.od.genres().size > 20)
        assertTrue(repo.od.schedule().sumOf { it.items.size } > 20)
        val d = repo.od.detail("od:${od[0]}")
        assertTrue(d.anime.title.isNotBlank() && d.episodes.isNotEmpty() && d.anime.genres.isNotEmpty() && d.anime.synopsis != null)
        val e = repo.od.episode("od:${od[1]}")
        assertTrue(e.number.isNotEmpty() && e.episodes.isNotEmpty())
        assertEquals("od:${od[0]}", e.anime?.id)
    }

    @Test fun anichin() = runBlocking {
        val home = repo.ac.home()
        assertTrue("latest ${home.latest.size}", home.latest.size >= 5)
        assertTrue(home.latest.all { it.episodeId?.startsWith("ac:") == true && !it.episode.isNullOrEmpty() })
        val list = repo.ac.list("popular")
        assertTrue(list.items.size >= 10 && list.hasMore)
        assertTrue(repo.ac.search("renegade").isNotEmpty())
        assertTrue(repo.ac.genres().size > 10)
        assertTrue(repo.ac.schedule().sumOf { it.items.size } > 20)
        val d = repo.ac.detail("ac:${ac[0]}")
        assertTrue(d.anime.title.isNotBlank() && d.episodes.size > 10 && d.anime.rating != null)
        assertTrue(d.episodes.all { "-episode-" in it.id })
        val e = repo.ac.episode("ac:${ac[1]}")
        assertTrue(e.number.isNotEmpty() && e.episodes.isNotEmpty())
        assertNotNull(e.prev)
        assertEquals("ac:${ac[0]}", e.anime?.id)
    }
}
