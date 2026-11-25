package com.freease.music.stream.data

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient

/** Satu pintu Freease Stream: anime (Animekompi + Otakudesu), donghua (Anichin), dan tujuh sumber komik. */
class StreamRepository(base: OkHttpClient) {
    val http = StreamHttp(base)
    private val resolvers = Resolvers(http)
    val ak = Animekompi(http, resolvers)
    val od = Otakudesu(http, resolvers)
    val ac = Anichin(http, resolvers)
    private val cache = TtlCache(400)

    val mangaSources: List<MangaSource> = listOf(
        Komiku(http), Shinigami(http),
        AnimposxSource(http, "ki", "Komikindo", "https://komikindo.ch", "daftar-manga"),
        AnimposxSource(http, "bk", "Bacakomik", "https://bacakomik.my", "daftar-komik"),
        Webtoon(http), MangaPark(http), MangaGoku(http),
    )
    fun mangaSource(key: String) = mangaSources.firstOrNull { it.key == key }

    /** Sumber lambat/gagal tidak boleh menahan yang lain. */
    private suspend fun <T> quiet(ms: Long = 12_000, fallback: T, block: suspend () -> T): T =
        runCatching { withTimeoutOrNull(ms) { block() } }.getOrNull() ?: fallback

    // ---------------------------------------------------------------- anime & donghua

    data class AnimeHome(val ak: Animekompi.Home, val odLatest: List<Anime>, val odCompleted: List<Anime>)
    data class DonghuaHome(val latest: List<Anime>, val recommended: List<Anime>, val popular: List<Anime>, val ongoing: List<Anime>,
                           val completed: List<Anime>, val animekompi: List<Anime>)

    suspend fun animeHome(): AnimeHome = cache.get("home", 3 * MIN) {
        coroutineScope {
            val a = async { ak.home() }
            val o = async { quiet(fallback = Page(emptyList<Anime>(), 1, false)) { od.list(false) } }
            val c = async { quiet(fallback = Page(emptyList<Anime>(), 1, false)) { od.list(true) } }
            AnimeHome(a.await(), o.await().items, c.await().items)
        }
    }

    suspend fun donghuaHome(): DonghuaHome = cache.get("dh", 3 * MIN) {
        coroutineScope {
            val h = async { ac.home() }
            val p = async { quiet(fallback = Page(emptyList<Anime>(), 1, false)) { ac.list("popular") } }
            val o = async { quiet(fallback = Page(emptyList<Anime>(), 1, false)) { ac.list("latest", status = "ongoing") } }
            val c = async { quiet(fallback = Page(emptyList<Anime>(), 1, false)) { ac.list("latest", status = "completed") } }
            val k = async { quiet(fallback = Page(emptyList<Anime>(), 1, false)) { ak.browse("latest", genre = "donghua") } }
            val home = h.await()
            DonghuaHome(home.latest, home.recommended, p.await().items, o.await().items, c.await().items, k.await().items)
        }
    }

    /** source: "" (Animekompi), "od", "ac". */
    suspend fun browse(source: String, order: String, page: Int, genre: String?, type: String?, status: String?): Page<Anime> =
        cache.get("b:$source:$order:$page:$genre:$type:$status", 5 * MIN) {
            when (source) {
                "od" -> if (!genre.isNullOrBlank()) od.byGenre(genre, page) else od.list(status == "completed", page)
                "ac" -> ac.list(order, page, status, genre)
                else -> ak.browse(order, page, genre, type, status)
            }
        }

    suspend fun genres(source: String): List<Genre> = cache.get("g:$source", 6 * 60 * MIN) {
        when (source) { "od" -> od.genres(); "ac" -> ac.genres(); else -> ak.genres() }
    }

    /** Cari di semua sumber anime/donghua; hasil diselang-seling supaya tiap sumber kebagian tempat di atas. */
    suspend fun searchAnime(q: String): List<Anime> {
        val s = q.trim().take(100)
        if (s.isEmpty()) return emptyList()
        return cache.get("sa:${s.lowercase()}", 10 * MIN) {
            coroutineScope {
                val lists = listOf(async { quiet(fallback = emptyList()) { ak.search(s) } }, async { quiet(fallback = emptyList()) { od.search(s) } },
                    async { quiet(fallback = emptyList()) { ac.search(s) } }).map { it.await() }
                interleave(lists)
            }
        }
    }

    suspend fun schedule(donghua: Boolean): List<ScheduleDay> = cache.get("sch:$donghua", 15 * MIN) {
        if (donghua) ac.schedule() else coroutineScope {
            val a = async { ak.schedule() }
            val o = async { quiet(fallback = emptyList()) { od.schedule() } }
            val akDays = a.await()
            val odDays = o.await()
            akDays.map { d ->
                val extra = odDays.firstOrNull { it.day == d.day }?.items.orEmpty().filter { x -> d.items.none { sameTitle(it.title, x.title) } }
                d.copy(items = d.items + extra)
            }
        }
    }

    suspend fun detail(id: String): AnimeDetail = cache.get("d:$id", 5 * MIN) {
        when { Otakudesu.own(id) -> od.detail(id); Anichin.own(id) -> ac.detail(id); else -> ak.detail(id) }
    }

    /** Tautan video kedaluwarsa ±1 jam: disimpan sebentar, dan hasil kosong tidak disimpan. */
    suspend fun episode(id: String): EpisodeData {
        val key = "e:$id"
        return cache.get(key, 30 * MIN) {
            when { Otakudesu.own(id) -> od.episode(id); Anichin.own(id) -> ac.episode(id); else -> ak.episode(id) }
        }
    }

    /** Judul yang sama di sumber anime lain (untuk pindah sumber kalau server di satu sumber kosong). */
    suspend fun alternatives(anime: Anime, alt: String?): List<Anime> {
        val words = anime.title.replace(Regex("[^\\p{L}\\p{N} ]"), " ").split(Regex("\\s+")).filter { it.isNotBlank() }.take(4).joinToString(" ")
        if (words.isEmpty()) return emptyList()
        val all = searchAnime(words)
        return all.filter { it.id != anime.id && (sameTitle(anime.title, it.title) || (alt != null && sameTitle(alt.split(',', ';').first().trim(), it.title))) }.take(6)
    }

    // ---------------------------------------------------------------- komik

    data class MangaHome(val popular: List<Manga>, val latest: List<Manga>, val manhwa: List<Manga>, val webtoons: List<Manga>, val indo: List<Manga>, val english: List<Manga>)

    suspend fun mangaHome(): MangaHome = cache.get("mh", 15 * MIN) {
        coroutineScope {
            val sh = async { quiet(8_000, emptyList()) { mangaSource("sh")!!.browse("popular", 1, null) } }
            val km = async { quiet(fallback = emptyList()) { mangaSource("km")!!.browse("popular", 1, null) } }
            val kmLatest = async { quiet(fallback = emptyList()) { mangaSource("km")!!.browse("latest", 1, null) } }
            val manhwa = async { quiet(fallback = emptyList()) { mangaSource("km")!!.browse("popular", 1, "manhwa") } }
            val wt = async { quiet(fallback = emptyList()) { mangaSource("wt")!!.browse("popular", 1, null) } }
            val ki = async { quiet(fallback = emptyList()) { mangaSource("ki")!!.browse("latest", 1, null) } }
            val kk = async { quiet(fallback = emptyList()) { mangaSource("kk")!!.browse("popular", 1, null) } }
            MangaHome(sh.await().ifEmpty { km.await() }, kmLatest.await(), manhwa.await(), wt.await(), ki.await(), kk.await())
        }
    }

    suspend fun browseManga(key: String, order: String, page: Int, type: String?): List<Manga> = cache.get("mb:$key:$order:$page:$type", 10 * MIN) {
        (mangaSource(key) ?: throw SourceException("Sumber tidak dikenal")).browse(order, page.coerceIn(1, 200), type)
    }

    suspend fun searchManga(q: String): List<Manga> {
        val s = q.trim().take(100)
        if (s.isEmpty()) return emptyList()
        return cache.get("sm:${s.lowercase()}", 10 * MIN) {
            coroutineScope { interleave(mangaSources.map { src -> async { quiet(fallback = emptyList()) { src.search(s) } } }.map { it.await() }) }
        }
    }

    private fun route(id: String): Pair<MangaSource, String> {
        val k = id.substringBefore(':')
        val src = mangaSource(k) ?: throw SourceException("ID komik tidak valid")
        return src to id.substringAfter(':')
    }

    suspend fun mangaDetail(id: String): MangaDetail = cache.get("md:$id", 15 * MIN) { route(id).let { (s, raw) -> s.detail(raw) } }

    suspend fun pages(chapterId: String): List<Img> = cache.get("p:$chapterId", 60 * MIN) {
        route(chapterId).let { (s, raw) -> s.pages(raw) }.ifEmpty { throw SourceException("Halaman bab ini tidak ditemukan di sumber") }
    }

    /** Judul yang sama di sumber komik lain. */
    suspend fun mangaAlternatives(m: Manga): List<Manga> = coroutineScope {
        val names = (listOf(m.title) + m.altTitles.filter { it.filter(Char::isLetterOrDigit).length >= 5 }).take(2)
        mangaSources.filter { it.key != m.id.substringBefore(':') }.map { src ->
            async {
                names.firstNotNullOfOrNull { n -> quiet(10_000, emptyList<Manga>()) { src.search(n) }.firstOrNull { sameTitle(n, it.title, it.altTitles) } }
            }
        }.mapNotNull { it.await() }
    }

    private fun <T> interleave(lists: List<List<T>>): List<T> {
        val out = mutableListOf<T>()
        for (i in 0 until (lists.maxOfOrNull { it.size } ?: 0)) for (l in lists) l.getOrNull(i)?.let(out::add)
        return out
    }

    companion object { private const val MIN = 60_000L }
}
