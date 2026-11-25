package com.freease.music.stream

import com.freease.music.stream.data.StreamRepository
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Uji langsung ke situs sumber (bukan bagian tes biasa): `./gradlew testDebugUnitTest -PstreamLive --tests '*StreamLiveProbe*'`.
 * Laporan ditulis ke build/reports/stream-live.txt: tiap langkah berhasil/gagal dengan jumlah hasilnya.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StreamLiveProbe {
    @Test fun semuaSumber() = runBlocking {
        assumeTrue(System.getProperty("stream.live") == "true")
        val repo = StreamRepository(OkHttpClient())
        val out = StringBuilder()
        var ok = 0; var fail = 0
        suspend fun step(name: String, f: suspend () -> String) {
            val r = runCatching { withTimeoutOrNull(60_000) { f() } ?: error("timeout") }
            r.onSuccess { ok++; out.append("OK   $name: $it\n") }.onFailure { fail++; out.append("GAGAL $name: ${it.javaClass.simpleName} ${it.message}\n") }
        }
        step("anime home") { val h = repo.animeHome(); "ak latest=${h.ak.latest.size} trending=${h.ak.trending.size} od=${h.odLatest.size}/${h.odCompleted.size}" }
        step("donghua home") { val h = repo.donghuaHome(); "latest=${h.latest.size} pop=${h.popular.size} ongoing=${h.ongoing.size} ak=${h.animekompi.size}" }
        for (src in listOf("", "od", "ac")) {
            step("browse '$src'") { "${repo.browse(src, "popular", 1, null, null, null).items.size} item" }
            step("genres '$src'") { "${repo.genres(src).size} genre" }
        }
        step("search") { repo.searchAnime("one piece").groupBy { it.source }.mapValues { it.value.size }.toString() }
        step("schedule anime") { repo.schedule(false).joinToString { "${it.day}:${it.items.size}" } }
        step("schedule donghua") { repo.schedule(true).joinToString { "${it.day}:${it.items.size}" } }
        val h = runCatching { repo.animeHome() }.getOrNull()
        val dh = runCatching { repo.donghuaHome() }.getOrNull()
        val samples = listOfNotNull(h?.ak?.trending?.firstOrNull()?.id, h?.odLatest?.firstOrNull()?.id, dh?.popular?.firstOrNull()?.id)
        for (id in samples) {
            step("detail+episode $id") {
                val d = repo.detail(id)
                val e = repo.episode(d.episodes.first().id)
                "${d.anime.title} eps=${d.episodes.size} | ep ${e.number}: " + e.sources.joinToString { "${it.label} ${it.quality}${if (it.embed) " embed" else ""}" }
            }
        }
        step("manga home") { val m = repo.mangaHome(); "pop=${m.popular.size} latest=${m.latest.size} manhwa=${m.manhwa.size} wt=${m.webtoons.size} indo=${m.indo.size} en=${m.english.size}" }
        for (s in repo.mangaSources) {
            step("komik ${s.name}") {
                val list = s.browse("popular", 1, null)
                val d = repo.mangaDetail(list.first().id)
                val p = repo.pages(d.chapters.last().id)
                "${list.size} judul | ${d.manga.title}: ${d.chapters.size} bab | ${p.size} halaman"
            }
        }
        step("cari komik") { repo.searchManga("solo leveling").groupBy { it.source }.mapValues { it.value.size }.toString() }
        out.append("\nBerhasil $ok, gagal $fail\n")
        File("build/reports").mkdirs()
        File("build/reports/stream-live.txt").writeText(out.toString())
        println(out)
    }
}
