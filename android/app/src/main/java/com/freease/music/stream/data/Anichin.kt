package com.freease.music.stream.data

import android.util.Base64

/** Donghua (animasi China) sub Indonesia dari Anichin. ID diawali `ac:`. OK.ru di sana sering sampai 1080p. */
class Anichin(private val http: StreamHttp, private val resolvers: Resolvers) {
    private val cache = TtlCache(300)
    private suspend fun page(path: String, ttl: Long = 5 * MIN) = cache.get(path, ttl) { http.text(BASE + path, mapOf("Referer" to "$BASE/")) }

    private fun abs(u: String?) = u?.let { if (it.startsWith("http")) it else BASE + (if (it.startsWith("/")) it else "/$it") }
    private fun cover(u: String?) = img(abs(u?.let(::htmlLine)), "$BASE/")
    private fun slugOf(u: String?) = Regex("^/(?:anime/)?([^/?#\"]+)/?$").first(u.orEmpty().replace(Regex("^https?://[^/]+"), ""))
    private fun epNum(t: String?) = Regex("Episode\\s+(\\d+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE).first(t.orEmpty()).orEmpty()
    private fun stripEp(t: String?) = htmlLine(t).replace(Regex("\\s+Episode\\s+\\d+(?:\\.\\d+)?.*$", RegexOption.IGNORE_CASE), "").replace(Regex("\\s+Subtitle Indonesia$", RegexOption.IGNORE_CASE), "").trim()
    private fun isEp(slug: String?) = slug != null && Regex("-episode-\\d").containsMatchIn(slug)

    /** Kartu `.bsx`: seri, atau episode terbaru (episodeId terisi). */
    private fun cards(html: String): List<Anime> = Regex("<div class=\"bsx\">\\s*<a href=\"([^\"]+)\"[^>]*title=\"([^\"]*)\"([\\s\\S]*?)</a>").findAll(html).mapNotNull { m ->
        val slug = slugOf(m.groupValues[1]) ?: return@mapNotNull null
        val b = m.groupValues[3]
        val epx = htmlLine(Regex("class=['\"]epx[^'\"]*['\"][^>]*>([^<]*)").first(b))
        val ep = epNum(m.groupValues[2]).ifEmpty { Regex("^Ep\\s*(\\d+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE).first(epx).orEmpty() }
        val latest = htmlLine(Regex("class=\"sb [^\"]*\">([^<]*)").first(b)).takeIf { Regex("^\\d+(\\.\\d+)?$").matches(it) }
        Anime(
            id = PREFIX + slug, title = if (isEp(slug)) stripEp(m.groupValues[2]) else htmlLine(m.groupValues[2]),
            cover = cover(Regex("<img[^>]+src=\"([^\"]+)\"").first(b)), type = htmlLine(Regex("class=\"typez[^\"]*\">([^<]*)").first(b)).ifEmpty { "Donghua" },
            status = cleanStatus(epx), source = NAME, episode = ep.ifEmpty { latest }, episodeId = if (isEp(slug)) PREFIX + slug else null,
            note = Regex("(\\d{1,2}:\\d{2})").first(epx),
        )
    }.distinctBy { it.id }.toList()

    suspend fun list(order: String = "latest", page: Int = 1, status: String? = null, genre: String? = null): Page<Anime> {
        val n = page.coerceIn(1, 300)
        val o = mapOf("popular" to "popular", "latest" to "update", "rating" to "rating", "title" to "title")[order] ?: "update"
        val st = when (status) { "completed" -> "completed"; "ongoing" -> "ongoing"; else -> "" }
        val g = genre?.lowercase()?.filter { it.isLetterOrDigit() || it == '-' }?.take(40)
        val html = page("/anime/?page=$n&status=$st&type=&order=$o" + (g?.let { "&genre%5B%5D=$it" } ?: ""))
        val items = cards(html).map { it.copy(episodeId = null) }
        return Page(items, n, Regex("class=\"r\"[^>]*>\\s*Selanjutnya|rel=\"next\"").containsMatchIn(html))
    }

    data class Home(val latest: List<Anime>, val recommended: List<Anime>)

    suspend fun home(): Home {
        val html = page("/", 3 * MIN)
        fun seg(title: String): String {
            val i = html.indexOf("<h3>$title</h3>").takeIf { it >= 0 } ?: return ""
            val j = html.indexOf("class=\"releases\"", i + 20)
            return html.substring(i, if (j > 0) j else minOf(html.length, i + 60000))
        }
        return Home(cards(seg("Rilisan Terbaru")).filter { it.episodeId != null }, cards(seg("Rekomendasi")).map { it.copy(episodeId = null) })
    }

    suspend fun search(q: String): List<Anime> = cards(page("/?s=${q.urlEncode()}", 10 * MIN)).map { it.copy(episodeId = null) }

    suspend fun genres(): List<Genre> = Regex("name=\"genre\\[\\]\"[^>]*value=\"([^\"]+)\"[^>]*>\\s*<label[^>]*>([^<]+)<")
        .findAll(page("/anime/", 24 * 60 * MIN)).map { Genre(it.groupValues[1], htmlLine(it.groupValues[2])) }
        .filter { it.name.length >= 3 }.distinctBy { it.id }.toList()

    suspend fun schedule(): List<ScheduleDay> {
        val html = page("/schedule/", 30 * MIN)
        val days = mapOf("sch_monday" to "Senin", "sch_tuesday" to "Selasa", "sch_wednesday" to "Rabu", "sch_thursday" to "Kamis",
            "sch_friday" to "Jumat", "sch_saturday" to "Sabtu", "sch_sunday" to "Minggu")
        val out = Animekompi.DAYS.associateWith { mutableListOf<ScheduleItem>() }
        for (m in Regex("class=\"bixbox schedulepage (sch_[a-z]+)\"([\\s\\S]*?)(?=class=\"bixbox schedulepage|<div id=\"sidebar\"|$)").findAll(html)) {
            val day = days[m.groupValues[1]] ?: continue
            for (c in cards(m.groupValues[2])) out[day]!! += ScheduleItem(c.id, c.title, c.cover, c.episode.orEmpty(), c.note, NAME)
        }
        return Animekompi.DAYS.map { ScheduleDay(it, out[it]!!) }
    }

    private fun spe(html: String, label: String) = htmlLine(Regex("<b>$label:?</b>([\\s\\S]*?)</span>", RegexOption.IGNORE_CASE).first(html)).ifEmpty { null }

    suspend fun detail(id: String): AnimeDetail {
        val slug = check(id)
        var html = page("/$slug/")
        if ("class=\"eplister\"" !in html) html = runCatching { page("/anime/$slug/") }.getOrDefault(html)
        if ("class=\"eplister\"" !in html) throw SourceException("Donghua tidak ditemukan")
        val list = Regex("class=\"eplister\"[\\s\\S]*?</ul>").first(html, 0).orEmpty()
        val eps = Regex("<a href=\"([^\"]+)\">([\\s\\S]*?)</a>").findAll(list).mapNotNull { m ->
            val ep = slugOf(m.groupValues[1])?.takeIf(::isEp) ?: return@mapNotNull null
            val b = m.groupValues[2]
            EpisodeRef(PREFIX + ep, htmlLine(Regex("class=\"epl-num\">([^<]*)").first(b)).ifEmpty { epNum(ep.replace('-', ' ')) },
                htmlLine(Regex("class=\"epl-title\">([^<]*)").first(b)).ifEmpty { "Episode ${epNum(ep.replace('-', ' '))}" },
                htmlLine(Regex("class=\"epl-date\">([^<]*)").first(b)).ifEmpty { null })
        }.toList().sortedByDescending { it.number.toDoubleOrNull() ?: 0.0 }
        val anime = Anime(
            id = PREFIX + slug, title = htmlLine(Regex("<h1 class=\"entry-title\"[^>]*>([\\s\\S]*?)</h1>").first(html) ?: slug),
            cover = cover(Regex("class=\"thumb\"[^>]*>\\s*<img[^>]+src=\"([^\"]+)\"").first(html)),
            synopsis = htmlText(Regex("class=\"entry-content\"[^>]*>([\\s\\S]*?)</div>").first(html)).ifEmpty { null },
            type = spe(html, "Tipe") ?: "Donghua", status = cleanStatus(spe(html, "Status")),
            year = Regex("(\\d{4})").first(spe(html, "Tanggal rilis").orEmpty())?.toIntOrNull(),
            rating = Regex("<strong>Rating\\s*([\\d.]+)").first(html), studio = spe(html, "Studio"),
            genres = Regex(">([^<]+)</a>").findAll(Regex("class=\"genxed\">([\\s\\S]*?)</div>").first(html).orEmpty()).map { htmlLine(it.groupValues[1]) }.toList(),
            source = NAME,
        )
        return AnimeDetail(anime, htmlLine(Regex("<span class=\"alter\">([^<]*)").first(html)).ifEmpty { null }, eps)
    }

    suspend fun episode(id: String): EpisodeData {
        val slug = check(id)
        val html = page("/$slug/", 10 * MIN)
        val title = htmlLine(Regex("<h1 class=\"entry-title\"[^>]*>([\\s\\S]*?)</h1>").first(html))
        if (title.isEmpty()) throw SourceException("Episode tidak ditemukan")
        val series = slugOf(Regex("series <a href=\"([^\"]+)\"").first(html) ?: Regex("href='([^']+)' aria-label='Semua Episode'").first(html))
        // Tautan sebelum/berikutnya kadang menunjuk pengumuman (hiatus): yang dipakai cuma halaman episode.
        val prev = slugOf(Regex("<a[^>]*href=\"([^\"]+)\"[^>]*rel=\"prev\"").first(html))?.takeIf(::isEp)
        val next = slugOf(Regex("<a[^>]*href=\"([^\"]+)\"[^>]*rel=\"next\"").first(html))?.takeIf(::isEp)
        val list = Regex("<a href=\"([^\"]+)\"[\\s\\S]*?<h3>([\\s\\S]*?)</h3>").findAll(Regex("class=\"episodelist\">[\\s\\S]*?</ul>").first(html, 0).orEmpty())
            .mapNotNull { m -> slugOf(m.groupValues[1])?.takeIf(::isEp)?.let { EpisodeRef(PREFIX + it, epNum(m.groupValues[2]), htmlLine(m.groupValues[2])) } }.toList()
        val mirrors = Regex("<option[^>]*value=\"([A-Za-z0-9+/=]{16,})\"[^>]*>([^<]*)").findAll(html).mapNotNull { m ->
            val dec = runCatching { String(Base64.decode(m.groupValues[1], Base64.DEFAULT)) }.getOrNull() ?: return@mapNotNull null
            Regex("src=\"([^\"]+)\"", RegexOption.IGNORE_CASE).first(dec)?.takeIf { it.startsWith("https:") }?.let { htmlLine(m.groupValues[2]) to it }
        }.toList()
        val sources = coroutineScopeAll(mirrors) { (label, url) -> resolvers.resolve(url, label) }
        val anime = series?.let { runCatching { detail(PREFIX + it).anime }.getOrNull() }
        fun num(s: String) = list.firstOrNull { it.id == PREFIX + s }?.number?.ifEmpty { null } ?: epNum(s.replace('-', ' '))
        return EpisodeData(
            id = PREFIX + slug, number = Regex("itemprop=\"episodeNumber\" content=\"([^\"]+)\"").first(html) ?: epNum(title),
            title = title.replace(Regex("\\s*Subtitle Indonesia\\s*$", RegexOption.IGNORE_CASE), ""), anime = anime,
            prev = prev?.let { EpisodeRef(PREFIX + it, num(it), "") }, next = next?.let { EpisodeRef(PREFIX + it, num(it), "") },
            sources = Resolvers.sort(sources), episodes = list,
        )
    }

    private fun check(id: String): String {
        val s = id.removePrefix(PREFIX)
        if (!id.startsWith(PREFIX) || !SLUG.matches(s)) throw SourceException("ID tidak valid")
        return s
    }

    companion object {
        const val NAME = "Anichin"
        const val PREFIX = "ac:"
        const val BASE = "https://anichin.moe"
        private const val MIN = 60_000L
        private val SLUG = Regex("^[a-z0-9][a-z0-9._-]{0,200}$", RegexOption.IGNORE_CASE)
        fun own(id: String) = id.startsWith(PREFIX)
    }
}
