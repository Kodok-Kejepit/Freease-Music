package com.freease.music.stream.data

import android.util.Base64
import org.json.JSONObject

/** Anime dari Otakudesu (HTML, rilis sangat cepat). ID diawali `od:`. */
class Otakudesu(private val http: StreamHttp, private val resolvers: Resolvers) {
    private val cache = TtlCache(300)
    private suspend fun page(path: String, ttl: Long = 5 * MIN) = cache.get(path, ttl) { http.text(BASE + path, mapOf("Referer" to "$BASE/")) }

    private fun slugOf(url: String?, kind: String) = Regex("/$kind/([^/?#\"]+)/?").first(url.orEmpty())
    private fun cleanTitle(t: String?) = htmlLine(t).replace(Regex("\\s*(\\(Episode[^)]*\\))?\\s*Sub(title)?\\s*Indo(nesia)?\\s*$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\s+Sub\\s*Indo.*$", RegexOption.IGNORE_CASE), "").trim()
    private fun epNum(t: String?) = Regex("Episode\\s+(\\d+(?:\\.\\d+)?)", RegexOption.IGNORE_CASE).first(t.orEmpty()).orEmpty()

    private fun card(slug: String, title: String, cover: String?, extra: Anime.() -> Anime = { this }) =
        Anime(PREFIX + slug, title, img(cover, "$BASE/"), source = NAME).extra()

    private fun detposts(html: String): List<Anime> = Regex("<div class=['\"]detpost['\"]>([\\s\\S]*?)</h2>").findAll(html).mapNotNull { m ->
        val b = m.groupValues[1]
        val slug = slugOf(Regex("href=\"([^\"]+)\"").first(b), "anime") ?: return@mapNotNull null
        val ep = htmlLine(Regex("class=['\"]epz['\"]>([\\s\\S]*?)</div>").first(b))
        val meta = htmlLine(Regex("class=['\"]epztipe['\"]>([\\s\\S]*?)</div>").first(b))
        card(slug, cleanTitle(Regex("class=\"jdlflm\">([\\s\\S]*)$").first(b)), Regex("<img[^>]+src=\"([^\"]+)\"").first(b)) {
            copy(
                episode = Regex("(\\d+(?:\\.\\d+)?)").first(ep),
                rating = meta.takeIf { Regex("^\\d+(\\.\\d+)?$").matches(it) },
                note = listOfNotNull(meta.takeIf { it.isNotEmpty() && !it.first().isDigit() }, htmlLine(Regex("class=\"newnime\">([\\s\\S]*?)</div>").first(b)).ifEmpty { null }).joinToString(" • "),
                status = if (Regex("Episode\\s+\\d", RegexOption.IGNORE_CASE).containsMatchIn(ep)) "Ongoing" else "Tamat",
            )
        }
    }.distinctBy { it.id }.toList()

    private fun lastPage(html: String) = Regex("/page/(\\d+)/?\"").findAll(html).maxOfOrNull { it.groupValues[1].toInt() } ?: 1

    suspend fun list(completed: Boolean, page: Int = 1): Page<Anime> {
        val n = page.coerceIn(1, 300)
        val html = page("/${if (completed) "complete-anime" else "ongoing-anime"}/${if (n > 1) "page/$n/" else ""}", 4 * MIN)
        return Page(detposts(html), n, n < lastPage(html))
    }

    suspend fun byGenre(genre: String, page: Int = 1): Page<Anime> {
        val g = genre.lowercase().filter { it.isLetterOrDigit() || it == '-' }.take(40)
        val n = page.coerceIn(1, 300)
        val html = page("/genres/$g/${if (n > 1) "page/$n/" else ""}", 30 * MIN)
        val items = Regex("<div class=\"col-anime\">([\\s\\S]*?)<div class=\"col-anime-trailer\">").findAll(html).mapNotNull { m ->
            val b = m.groupValues[1]
            val slug = slugOf(Regex("col-anime-title\"><a href=\"([^\"]+)\"").first(b), "anime") ?: return@mapNotNull null
            card(slug, cleanTitle(Regex("col-anime-title\"><a[^>]*>([\\s\\S]*?)</a>").first(b)), Regex("col-anime-cover\"><img src=\"([^\"]+)\"").first(b)) {
                copy(
                    studio = htmlLine(Regex("col-anime-studio\">([\\s\\S]*?)</div>").first(b)).ifEmpty { null },
                    rating = htmlLine(Regex("col-anime-rating\">([\\s\\S]*?)</div>").first(b)).ifEmpty { null },
                    year = Regex("col-anime-date\">[^<]*?(\\d{4})").first(b)?.toIntOrNull(),
                )
            }
        }.toList()
        return Page(items, n, n < lastPage(html))
    }

    suspend fun genres(): List<Genre> {
        val seg = Regex("class=\"genres\">([\\s\\S]*?)</ul>").first(page("/genre-list/", 24 * 60 * MIN)).orEmpty()
        return Regex("href=\"/genres/([^/\"]+)/?\"[^>]*>([^<]+)<").findAll(seg).map { Genre(it.groupValues[1], htmlLine(it.groupValues[2])) }.toList()
    }

    suspend fun search(q: String): List<Anime> = Regex("<li style='list-style:none;'>([\\s\\S]*?)</li>")
        .findAll(page("/?s=${q.urlEncode()}&post_type=anime", 10 * MIN)).mapNotNull { m ->
            val b = m.groupValues[1]
            val slug = slugOf(Regex("<h2><a href=\"([^\"]+)\"").first(b), "anime") ?: return@mapNotNull null
            card(slug, cleanTitle(Regex("<h2><a[^>]*>([\\s\\S]*?)</a>").first(b)), Regex("<img[^>]+src=\"([^\"]+)\"").first(b)) {
                copy(status = cleanStatus(Regex("<b>Status</b>\\s*:\\s*([^<]*)").first(b)), rating = Regex("<b>Rating</b>\\s*:\\s*([^<]*)").first(b)?.trim()?.ifEmpty { null })
            }
        }.toList()

    suspend fun schedule(): List<ScheduleDay> {
        val html = page("/jadwal-rilis/", 30 * MIN)
        val out = Animekompi.DAYS.associateWith { mutableListOf<ScheduleItem>() }
        for (m in Regex("<div class=\"kglist321\"><h2>([^<]+)</h2><ul>([\\s\\S]*?)</ul>").findAll(html)) {
            val name = htmlLine(m.groupValues[1]).lowercase().replace("jum'at", "jumat")
            val day = Animekompi.DAYS.firstOrNull { it.lowercase() == name } ?: continue
            for (a in Regex("<a href=\"([^\"]+)\"[^>]*>([^<]+)</a>").findAll(m.groupValues[2])) {
                val slug = slugOf(a.groupValues[1], "anime") ?: continue
                out[day]!! += ScheduleItem(PREFIX + slug, htmlLine(a.groupValues[2]), null, "", null, NAME)
            }
        }
        return Animekompi.DAYS.map { ScheduleDay(it, out[it]!!) }
    }

    private fun info(html: String, label: String) = htmlLine(Regex("<b>$label</b>\\s*:?\\s*([\\s\\S]*?)</span>", RegexOption.IGNORE_CASE).first(html)).removePrefix(":").trim()

    suspend fun detail(id: String): AnimeDetail {
        val slug = check(id)
        val html = page("/anime/$slug/")
        if (!Regex("class=['\"]fotoanime").containsMatchIn(html)) throw SourceException("Anime tidak ditemukan")
        val eps = Regex("<div class=\"episodelist\">([\\s\\S]*?)</ul>").findAll(html).flatMap { l ->
            Regex("<li><span><a href=\"([^\"]+)\"[^>]*>([^<]+)</a></span>(?:<span class='zeebr'[^>]*>([^<]*)</span>)?").findAll(l.groupValues[1]).mapNotNull { a ->
                val ep = slugOf(a.groupValues[1], "episode") ?: return@mapNotNull null
                EpisodeRef(PREFIX + ep, epNum(a.groupValues[2]).ifEmpty { if (Regex("movie|film", RegexOption.IGNORE_CASE).containsMatchIn(a.groupValues[2])) "1" else "" },
                    htmlLine(a.groupValues[2]), a.groupValues[3].takeIf { it.isNotBlank() }?.let(::htmlLine))
            }
        }.toList().sortedByDescending { it.number.toDoubleOrNull() ?: 0.0 }
        val title = info(html, "Judul").ifEmpty { cleanTitle(Regex("<h1>([^<]+)").first(html)) }
        val anime = card(slug, title, Regex("class=['\"]fotoanime[^>]*><img[^>]+src=\"([^\"]+)\"").first(html)) {
            copy(
                synopsis = htmlText(Regex("class=['\"]sinopc['\"]>([\\s\\S]*?)</div>").first(html)).ifEmpty { null },
                type = info(html, "Tipe").ifEmpty { null }, status = cleanStatus(info(html, "Status")),
                year = Regex("(\\d{4})").first(info(html, "Tanggal Rilis"))?.toIntOrNull(), rating = info(html, "Skor").ifEmpty { null },
                studio = info(html, "Studio").ifEmpty { null },
                genres = Regex(">([^<]+)</a>").findAll(Regex("<b>Genre</b>([\\s\\S]*?)</span>").first(html).orEmpty()).map { htmlLine(it.groupValues[1]) }.toList(),
            )
        }
        return AnimeDetail(anime, info(html, "Japanese").ifEmpty { null }, eps)
    }

    private suspend fun ajax(form: Map<String, String>): String? {
        val r = http.postForm("$BASE/wp-admin/admin-ajax.php", form, mapOf("Referer" to "$BASE/", "X-Requested-With" to "XMLHttpRequest"))
        return runCatching { JSONObject(r).str("data") }.getOrNull()
    }

    suspend fun episode(id: String): EpisodeData {
        val slug = check(id)
        val html = page("/episode/$slug/", 10 * MIN)
        val title = htmlLine(Regex("<h1 class=\"posttl\">([\\s\\S]*?)</h1>").first(html))
        if (title.isEmpty()) throw SourceException("Episode tidak ditemukan")
        val animeSlug = slugOf(Regex("<div class='flir'>[\\s\\S]*?<a href=\"([^\"]+/anime/[^\"]+)\"").first(html), "anime")
        val prev = slugOf(Regex("<a href=\"([^\"]+)\"[^>]*title=\"Episode Sebelumnya\"").first(html), "episode")
        val next = slugOf(Regex("<a href=\"([^\"]+)\"[^>]*title=\"Episode Selanjutnya\"").first(html), "episode")
        val list = Regex("<option value=\"([^\"]+/episode/[^\"]+)\"[^>]*>([^<]+)").findAll(Regex("id=\"selectcog\"[\\s\\S]*?</select>").first(html, 0).orEmpty())
            .mapNotNull { m -> slugOf(m.groupValues[1], "episode")?.let { EpisodeRef(PREFIX + it, epNum(m.groupValues[2]).ifEmpty { htmlLine(m.groupValues[2]) }, htmlLine(m.groupValues[2])) } }.toList()
        fun num(s: String) = list.firstOrNull { it.id == PREFIX + s }?.number ?: epNum(s.replace('-', ' '))

        // Tiap mirror minta tanda (nonce) lalu kode embed; kode aksinya diambil dari skrip halaman karena bisa berganti.
        val acts = Regex("action:\"([a-f0-9]{32})\"").findAll(html).map { it.groupValues[1] }.toList()
        val nonceAct = Regex("data:\\{action:\"([a-f0-9]{32})\"\\}").first(html)
        val embedAct = acts.firstOrNull { it != nonceAct }
        data class Mirror(val quality: String, val content: String, val name: String)
        val mirrors = Regex("<ul class=\"m(\\d+p)\"[^>]*>([\\s\\S]*?)</ul>").findAll(html).flatMap { ul ->
            Regex("data-content=\"([^\"]+)\"[^>]*>([^<]+)<").findAll(ul.groupValues[2]).map { Mirror(ul.groupValues[1], it.groupValues[1], htmlLine(it.groupValues[2])) }
        }.filter { WANT.containsMatchIn(it.name) }.toList()
        val iframe = Regex("id=\"pembed\">(?:<div[^>]*>)?<[a-z]+ src=\"(https://[^\"]+)\"").first(html)

        val jobs = mutableListOf<suspend () -> List<VideoSource>>()
        if (iframe != null) jobs += { resolvers.resolve(iframe, "ODCDN", "480p") }
        if (mirrors.isNotEmpty() && nonceAct != null && embedAct != null) {
            val nonce = runCatching { ajax(mapOf("action" to nonceAct)) }.getOrNull()
            if (nonce != null) for (m in mirrors) jobs += {
                val d = JSONObject(String(Base64.decode(m.content, Base64.DEFAULT)))
                val form = mutableMapOf("nonce" to nonce, "action" to embedAct)
                d.keys().forEach { k -> form[k] = d.get(k).toString() }
                val enc = ajax(form)
                val src = enc?.let { Regex("src=\"([^\"]+)\"").first(String(Base64.decode(it, Base64.DEFAULT))) }
                val label = when {
                    "mega" in m.name.lowercase() -> "MEGA"; "cdn" in m.name.lowercase() -> "ODCDN"
                    Regex("desu|stream", RegexOption.IGNORE_CASE).containsMatchIn(m.name) -> "Desustream"
                    "blog" in m.name.lowercase() -> "Blogger"; "filedon" in m.name.lowercase() -> "Filedon"
                    "vidhide" in m.name.lowercase() -> "VidHide"; else -> m.name
                }
                if (src != null) resolvers.resolve(decodeEntities(src), label, m.quality) else emptyList()
            }
        }
        val sources = coroutineScopeAll(jobs) { it() }
        val anime = animeSlug?.let { runCatching { detail(PREFIX + it).anime }.getOrNull() }
        return EpisodeData(
            id = PREFIX + slug, number = num(slug), title = title.replace(Regex("\\s*Subtitle Indonesia\\s*$", RegexOption.IGNORE_CASE), ""),
            anime = anime, prev = prev?.let { EpisodeRef(PREFIX + it, num(it), "") }, next = next?.let { EpisodeRef(PREFIX + it, num(it), "") },
            sources = Resolvers.sort(sources), episodes = list,
        )
    }

    private fun check(id: String): String {
        val s = id.removePrefix(PREFIX)
        if (!id.startsWith(PREFIX) || !SLUG.matches(s)) throw SourceException("ID tidak valid")
        return s
    }

    companion object {
        const val NAME = "Otakudesu"
        const val PREFIX = "od:"
        const val BASE = "https://otakudesu.blog"
        private const val MIN = 60_000L
        private val SLUG = Regex("^[a-z0-9][a-z0-9._-]{0,200}$", RegexOption.IGNORE_CASE)
        private val WANT = Regex("^(odcdn|ondesu|odstream|desu|blogs?|filedon|pdrain|mega|vidhide)", RegexOption.IGNORE_CASE)
        fun own(id: String) = id.startsWith(PREFIX)
    }
}
