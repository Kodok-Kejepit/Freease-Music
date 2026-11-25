package com.freease.music.stream.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONObject

/** Anime sub Indonesia dari Animekompi (API JSON). ID-nya slug polos tanpa awalan. */
class Animekompi(private val http: StreamHttp, private val resolvers: Resolvers) {
    private val cache = TtlCache(300)
    private suspend fun api(path: String, ttl: Long = 5 * MIN): Any = cache.get(path, ttl) { http.jsonAny(BASE + path, mapOf("Referer" to "$BASE/")) }
    private suspend fun obj(path: String, ttl: Long = 5 * MIN): JSONObject = api(path, ttl) as? JSONObject ?: JSONObject()

    private fun abs(u: String?): String? {
        val s = u?.trim().orEmpty()
        if (s.isEmpty() || s == "null") return null
        return if (s.startsWith("http")) s else BASE + (if (s.startsWith("/")) s else "/$s")
    }
    private fun num(v: Any?): String = when (v) {
        null, JSONObject.NULL -> ""
        is Number -> if (v.toDouble() % 1.0 == 0.0) v.toLong().toString() else v.toString()
        else -> v.toString().trim()
    }
    private fun status(s: String?) = when (s?.lowercase()) { "ongoing" -> "Ongoing"; "completed" -> "Tamat"; else -> s }

    fun card(o: JSONObject, genres: List<String>? = null): Anime = Anime(
        id = o.str("slug") ?: o.str("animeSlug").orEmpty(),
        title = o.str("title") ?: o.str("animeTitle") ?: o.str("slug").orEmpty(),
        cover = img(abs(o.str("cover"))),
        synopsis = o.str("synopsis"),
        type = o.str("type") ?: o.str("animeType"),
        status = status(o.str("status") ?: o.str("animeStatus")),
        year = o.optInt("year").takeIf { it > 0 },
        rating = o.str("rating"),
        studio = o.str("studio"),
        genres = genres ?: o.optJSONArray("genres").let { a -> (0 until (a?.length() ?: 0)).mapNotNull { i -> a!!.opt(i).let { g -> (g as? String) ?: (g as? JSONObject)?.str("name") } } },
        source = NAME,
    )
    private fun cards(a: org.json.JSONArray?) = a.objects().map { card(it) }.filter { it.id.isNotEmpty() }.distinctBy { it.id }

    data class Home(val featured: List<Anime>, val latest: List<Anime>, val trending: List<Anime>, val weekly: List<Anime>,
                    val allTime: List<Anime>, val ongoing: List<Anime>, val completed: List<Anime>, val movies: List<Anime>)

    suspend fun home(): Home {
        val h = obj("/api/home", 3 * MIN)
        return Home(
            featured = cards(h.optJSONArray("featured")),
            latest = h.optJSONArray("latestEpisodes").objects().map { e ->
                card(e).copy(episode = num(e.opt("episodeNumber")), episodeId = e.str("slug"), id = e.str("animeSlug") ?: card(e).id, note = e.str("createdAt"))
            },
            trending = cards(h.optJSONArray("trendingToday")),
            weekly = cards(h.optJSONArray("popularWeekly")),
            allTime = cards(h.optJSONArray("popularAllTime")),
            ongoing = cards(h.optJSONArray("ongoing")),
            completed = cards(h.optJSONArray("completed")),
            movies = cards(h.optJSONArray("movies")),
        )
    }

    suspend fun browse(order: String = "popular", page: Int = 1, genre: String? = null, type: String? = null, status: String? = null): Page<Anime> {
        val q = buildString {
            append("order=").append(if (order in ORDERS) order else "popular").append("&page=").append(page.coerceIn(1, 500))
            genre?.takeIf { it.isNotBlank() }?.let { append("&genre=").append(it.urlEncode()) }
            type?.takeIf { it.isNotBlank() }?.let { append("&type=").append(it.lowercase().urlEncode()) }
            status?.takeIf { it.isNotBlank() }?.let { append("&status=").append(it.lowercase().urlEncode()) }
        }
        val j = obj("/api/anime?$q")
        val total = j.optInt("totalPages", 1)
        return Page(cards(j.optJSONArray("data")), page, page < total)
    }

    suspend fun search(q: String): List<Anime> = cards(obj("/api/search?q=${q.urlEncode()}", 10 * MIN).optJSONArray("anime"))

    suspend fun genres(): List<Genre> = (api("/api/genres", 6 * 60 * MIN) as? org.json.JSONArray).objects()
        .filter { it.str("slug") != null && it.str("name") != null && it.optInt("count", 1) >= 5 }
        .map { Genre(it.str("slug")!!, it.str("name")!!) }

    suspend fun schedule(): List<ScheduleDay> {
        val j = obj("/api/schedule", 15 * MIN)
        val days = j.optJSONArray("days").objects()
        return DAYS.map { day ->
            val d = days.firstOrNull { it.optString("day").equals(day, true) }
            ScheduleDay(day, d?.optJSONArray("items").objects().filter { it.str("animeSlug") != null }.map {
                ScheduleItem(it.str("animeSlug")!!, it.str("title") ?: it.str("animeSlug")!!, img(abs(it.str("cover"))), num(it.opt("episode")), it.str("time"), NAME)
            })
        }
    }

    suspend fun detail(slug: String): AnimeDetail {
        val j = obj("/api/anime/${slug.urlEncode()}")
        val a = j.optJSONObject("anime") ?: throw SourceException("Anime tidak ditemukan")
        val genres = j.optJSONArray("genres").let { g -> (0 until (g?.length() ?: 0)).mapNotNull { i -> g!!.opt(i).let { x -> (x as? String) ?: (x as? JSONObject)?.str("name") } } }
        val eps = j.optJSONArray("episodes").objects().filter { it.str("slug") != null }.map {
            val n = num(it.opt("number")).ifEmpty { num(it.opt("numberLabel")) }
            EpisodeRef(it.str("slug")!!, n, it.str("title") ?: "Episode $n", it.str("releasedAt") ?: it.str("createdAt"))
        }.sortedByDescending { it.number.toDoubleOrNull() ?: 0.0 }
        return AnimeDetail(card(a, genres), a.str("altTitles"), eps)
    }

    suspend fun episode(slug: String): EpisodeData {
        val j = obj("/api/episodes/${slug.urlEncode()}", 10 * MIN)
        val ep = j.optJSONObject("episode") ?: throw SourceException("Episode tidak ditemukan")
        val genres = j.optJSONArray("genres").let { g -> (0 until (g?.length() ?: 0)).mapNotNull { i -> (g!!.opt(i) as? JSONObject)?.str("name") ?: g.opt(i) as? String } }
        val sources = coroutineScopeAll(j.optJSONArray("sources").objects()) { s ->
            resolvers.resolve(s.optString("url"), s.optString("label", "Server"), s.optString("quality"))
        }
        fun ref(o: JSONObject?) = o?.str("slug")?.let { EpisodeRef(it, num(o.opt("number")), "") }
        val n = num(ep.opt("number")).ifEmpty { num(ep.opt("numberLabel")) }
        return EpisodeData(
            id = slug, number = n, title = ep.str("title") ?: "Episode $n",
            anime = j.optJSONObject("anime")?.let { card(it, genres) },
            prev = ref(j.optJSONObject("prev")), next = ref(j.optJSONObject("next")),
            sources = Resolvers.sort(sources),
            episodes = j.optJSONArray("episodeList").objects().filter { it.str("slug") != null }.map {
                val en = num(it.opt("number")).ifEmpty { num(it.opt("numberLabel")) }
                EpisodeRef(it.str("slug")!!, en, it.str("title") ?: "Episode $en")
            },
        )
    }

    companion object {
        const val NAME = "Animekompi"
        const val BASE = "https://v11.animekompi.sbs"
        private const val MIN = 60_000L
        private val ORDERS = setOf("popular", "latest", "title", "rating", "updated")
        val DAYS = listOf("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu")
    }
}

/** Jalankan [f] untuk tiap elemen secara paralel; elemen yang gagal dicoba sekali lagi, lalu dilewati. */
suspend fun <T, R> coroutineScopeAll(items: List<T>, f: suspend (T) -> List<R>): List<R> = coroutineScope {
    items.map { item -> async { runCatching { f(item) }.recoverCatching { f(item) }.getOrDefault(emptyList()) } }.awaitAll().flatten()
}
