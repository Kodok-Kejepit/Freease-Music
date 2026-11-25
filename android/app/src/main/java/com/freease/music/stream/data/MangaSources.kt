package com.freease.music.stream.data

import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** Satu sumber komik. ID komik/bab berawalan [key] supaya satu jalur melayani semuanya. */
interface MangaSource {
    val key: String
    val name: String
    val lang: String
    val canBrowse: Boolean get() = true
    val hasOrder: Boolean get() = true
    val hasType: Boolean get() = false
    suspend fun browse(order: String, page: Int, type: String?): List<Manga>
    suspend fun search(q: String): List<Manga>
    suspend fun detail(raw: String): MangaDetail
    suspend fun pages(raw: String): List<Img>
}

// ---------------------------------------------------------------- Komiku (Indonesia)
class Komiku(private val http: StreamHttp) : MangaSource {
    override val key = "km"; override val name = "Komiku"; override val lang = "id"; override val hasType = true
    private val site = "https://komiku.org"
    private val api = "https://api.komiku.org/"
    private fun cover(u: String?) = img(u?.let(::htmlLine)?.substringBefore('?'), "$site/")

    private fun list(html: String): List<Manga> = Regex("<div class=\"bge\">([\\s\\S]*?)</div>\\s*</div>").findAll(html).mapNotNull { m ->
        val b = m.groupValues[1]
        val slug = Regex("href=\"[^\"]*/manga/([^/\"]+)/?\"").first(b) ?: return@mapNotNull null
        val title = Regex("<h3>\\s*([\\s\\S]*?)\\s*</h3>").first(b) ?: return@mapNotNull null
        Manga("km:$slug", htmlLine(title), cover(Regex("<img[^>]+(?:data-src|src)=\"(https?:[^\"]+)\"").first(b)), name, lang,
            Regex("<b>\\s*(Manga|Manhwa|Manhua)\\s*</b>", RegexOption.IGNORE_CASE).first(b),
            Regex("Terbaru:?[\\s\\S]*?<span>\\s*Chapter\\s*([\\d.]+)", RegexOption.IGNORE_CASE).first(b) ?: Regex("Chapter\\s*([\\d.]+)", RegexOption.IGNORE_CASE).first(b))
    }.distinctBy { it.id }.toList()

    override suspend fun browse(order: String, page: Int, type: String?): List<Manga> {
        val path = if (page > 1) "manga/page/$page/" else "manga/"
        val q = "orderby=" + (if (order == "latest") "modified" else "meta_value_num") + (type?.let { "&tipe=${it.lowercase()}" } ?: "")
        return list(http.text("$api$path?$q", ua = UA_MOBILE))
    }
    override suspend fun search(q: String) = list(http.text("$api?post_type=manga&s=${q.urlEncode()}", ua = UA_MOBILE))

    override suspend fun detail(raw: String): MangaDetail {
        val h = http.text("$site/manga/${raw.urlEncode()}/", ua = UA_MOBILE)
        fun row(label: String) = Regex("<td>$label:?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>").first(h)?.let(::htmlText)?.ifEmpty { null }
        val title = row("Judul") ?: htmlLine(Regex("<meta property=\"og:title\" content=\"(?:Komik )?([^\"]+)\"").first(h) ?: raw)
        val chapters = Regex("<td class=\"judulseries\">[\\s\\S]*?<a href=\"(/[^\"]+)\"[^>]*>[\\s\\S]*?<b>([\\s\\S]*?)</b>[\\s\\S]*?<td class=\"tanggalseries\">\\s*([^<]*?)\\s*</td>").findAll(h).map { m ->
            val label = htmlLine(m.groupValues[2])
            val d = m.groupValues[3].split('/').mapNotNull { it.trim().toIntOrNull() }
            val at = if (d.size == 3) java.util.GregorianCalendar(d[2], d[1] - 1, d[0]).timeInMillis else null
            Chapter("km:${m.groupValues[1]}", chapterNum(label), label.takeUnless { Regex("^Chapter\\s+[\\d.]+$", RegexOption.IGNORE_CASE).matches(it) }, at)
        }.toList()
        val manga = Manga("km:$raw", title, cover(Regex("<meta property=\"og:image\" content=\"([^\"]+)\"").first(h)), name, lang, row("Tipe") ?: row("Jenis Komik"),
            altTitles = (row("Judul Alternatif") ?: row("Judul Indonesia")).orEmpty().split(',', '/').map { it.trim() }.filter { it.isNotEmpty() && it != title })
        return MangaDetail(manga, htmlText(Regex("<p class=\"desc\"[^>]*>([\\s\\S]*?)</p>").first(h)),
            Regex("<li class=\"genre\">[\\s\\S]*?<span>([\\s\\S]*?)</span>").findAll(h).map { htmlLine(it.groupValues[1]) }.toList(),
            cleanStatus(row("Status")), row("Author") ?: row("Pengarang"), tidyChapters(chapters))
    }

    override suspend fun pages(raw: String): List<Img> {
        val h = http.text(site + raw, ua = UA_MOBILE)
        val start = h.indexOf("id=\"Baca_Komik\"").coerceAtLeast(0)
        return Regex("<img[^>]+src=\"(https://img\\.komiku[^\"]+)\"").findAll(h.substring(start)).map { htmlLine(it.groupValues[1]) }
            .filter { "/upload" in it }.distinct().mapNotNull { img(it, "$site/") }.toList()
    }
}

// ---------------------------------------------------------------- Shinigami (Indonesia, JSON)
class Shinigami(private val http: StreamHttp) : MangaSource {
    override val key = "sh"; override val name = "Shinigami"; override val lang = "id"; override val hasType = true
    private val api = "https://api.shngm.io/v1"
    private val ref = "https://shinigami.asia/"

    private fun card(d: JSONObject) = Manga(
        "sh:" + d.optString("manga_id"), d.optString("title").trim(), img(d.str("cover_portrait_url") ?: d.str("cover_image_url"), ref), name, lang,
        d.optJSONObject("taxonomy")?.optJSONArray("Format")?.optJSONObject(0)?.str("name"),
        d.opt("latest_chapter_number")?.takeIf { it != JSONObject.NULL }?.toString(),
        d.optString("alternative_title").split(',').map { it.trim() }.filter { it.isNotEmpty() },
    )

    override suspend fun browse(order: String, page: Int, type: String?): List<Manga> {
        val q = "page=$page&page_size=30&sort=" + (if (order == "latest") "latest" else "popularity") + (type?.let { "&format=${it.lowercase()}" } ?: "")
        return http.json("$api/manga/list?$q").optJSONArray("data").objects().map(::card)
    }
    override suspend fun search(q: String) = http.json("$api/manga/list?page=1&page_size=20&q=${q.urlEncode()}").optJSONArray("data").objects().map(::card)

    override suspend fun detail(raw: String): MangaDetail {
        val d = http.json("$api/manga/detail/${raw.urlEncode()}").optJSONObject("data") ?: throw SourceException("Komik tidak ditemukan")
        // API-nya hanya melayani halaman pertama daftar bab: ambil 24 bab awal + 24 bab terbaru.
        fun url(order: String) = "$api/chapter/${raw.urlEncode()}/list?page=1&page_size=24&sort_by=chapter_number&sort_order=$order"
        val asc = http.json(url("asc"))
        val desc = runCatching { http.json(url("desc")) }.getOrNull()
        val chapters = (asc.optJSONArray("data").objects() + desc?.optJSONArray("data").objects()).map {
            Chapter("sh:" + it.optString("chapter_id"), it.opt("chapter_number")?.takeIf { n -> n != JSONObject.NULL }?.toString()?.let(::chapterNum), it.str("chapter_title"), null)
        }
        val total = asc.optJSONObject("meta")?.optInt("total_record") ?: 0
        val tax = d.optJSONObject("taxonomy")
        return MangaDetail(card(d), htmlText(d.optString("description")),
            tax?.optJSONArray("Genre").objects().mapNotNull { it.str("name") },
            when (d.optInt("status")) { 1 -> "Ongoing"; 2 -> "Tamat"; 3 -> "Hiatus"; else -> null },
            tax?.optJSONArray("Author").objects().mapNotNull { it.str("name") }.joinToString(", ").ifEmpty { null },
            tidyChapters(chapters), partial = total > chapters.map { it.id }.toSet().size)
    }

    override suspend fun pages(raw: String): List<Img> {
        val d = http.json("$api/chapter/detail/${raw.urlEncode()}").optJSONObject("data") ?: return emptyList()
        val ch = d.optJSONObject("chapter") ?: return emptyList()
        val base = d.optString("base_url").trimEnd('/') + ch.optString("path")
        val files = ch.optJSONArray("data") ?: return emptyList()
        return (0 until files.length()).mapNotNull { img(base + files.optString(it), ref) }
    }
}

// ---------------------------------------------------------------- Komikindo & Bacakomik (Indonesia, tema yang sama)
/** Halaman bab memuat banner iklan di antara gambar; yang diambil cuma gambar ber-alt judul bab itu. */
class AnimposxSource(private val http: StreamHttp, override val key: String, override val name: String, private val base: String, private val listPath: String) : MangaSource {
    override val lang = "id"; override val hasType = true
    private fun cover(u: String?) = img(u?.let(::htmlLine)?.replace(Regex("\\?resize=.*$"), ""), "$base/")
    private fun slugOf(u: String?) = Regex("/komik/([^/\"?#]+)/?").first(u.orEmpty())

    private fun list(h: String): List<Manga> = Regex("<div class=\"animposx\">([\\s\\S]*?)(?=<div class=\"animepost\">|</section>|$)").findAll(h).mapNotNull { m ->
        val b = m.groupValues[1].take(6000)
        val slug = slugOf(Regex("<a href=\"([^\"]+)\"").first(b)) ?: return@mapNotNull null
        Manga("$key:$slug", htmlLine(Regex("title=\"(?:Komik\\s+)?([^\"]+)\"").first(b) ?: slug),
            cover(Regex("data-lazy-src=\"([^\"]+)\"").first(b) ?: Regex("<img[^>]+src=\"(https:[^\"]+)\"").first(b)), name, lang,
            Regex("typeflag (Manga|Manhwa|Manhua)", RegexOption.IGNORE_CASE).first(b), chapterNum(Regex("Ch(?:apter)?\\.?\\s*([\\d.]+)", RegexOption.IGNORE_CASE).first(b)))
    }.distinctBy { it.id }.toList()

    override suspend fun browse(order: String, page: Int, type: String?): List<Manga> {
        val q = "order=" + (if (order == "latest") "update" else "popular") + (type?.let { "&type=${it.lowercase()}" } ?: "")
        return list(http.text("$base/$listPath/${if (page > 1) "page/$page/" else ""}?$q"))
    }
    override suspend fun search(q: String) = list(http.text("$base/?s=${q.urlEncode()}"))

    override suspend fun detail(raw: String): MangaDetail {
        val h = http.text("$base/komik/${raw.urlEncode()}/")
        fun spe(label: String) = Regex("<b>$label:?</b>([\\s\\S]*?)</span>", RegexOption.IGNORE_CASE).first(h)?.let(::htmlLine)?.ifEmpty { null }
        val title = htmlLine(Regex("<h1 class=\"entry-title\"[^>]*>\\s*(?:Komik\\s+)?([\\s\\S]*?)</h1>").first(h) ?: raw)
        val chapters = Regex("<span class=\"lchx\">\\s*<a href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>").findAll(h).map { m ->
            Chapter("$key:" + m.groupValues[1].removePrefix(base), chapterNum(htmlLine(m.groupValues[2])), null)
        }.filter { it.id.startsWith("$key:/") }.toList()
        val genreSeg = Regex("class=\"genre-info\"[\\s\\S]*?</div>").first(h, 0) ?: Regex("<div class=\"genre[^\"]*\">([\\s\\S]*?)</div>").first(h).orEmpty()
        val manga = Manga("$key:$raw", title, cover(Regex("class=\"thumb\"[\\s\\S]{0,800}?(?:data-lazy-src|src)=\"(https:[^\"]+)\"").first(h)), name, lang,
            spe("Jenis Komik") ?: spe("Grafis"), altTitles = spe("Judul Alternatif").orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() && it != title }.take(6))
        return MangaDetail(manga, htmlText(Regex("entry-content-single\"[^>]*>([\\s\\S]*?)</div>").first(h)),
            Regex("rel=\"tag\"[^>]*>([^<]+)<").findAll(genreSeg).map { htmlLine(it.groupValues[1]) }.toList(),
            cleanStatus(spe("Status")), spe("Pengarang") ?: spe("Author"), tidyChapters(chapters))
    }

    override suspend fun pages(raw: String): List<Img> {
        if (!Regex("^/[a-z0-9._%-]+/?$", RegexOption.IGNORE_CASE).matches(raw)) throw SourceException("ID bab tidak valid")
        val c = http.text(base + raw)
        val t = htmlLine(Regex("<h1 class=\"entry-title\"[^>]*>\\s*(?:Komik\\s+)?([\\s\\S]*?)</h1>").first(c).orEmpty())
        if (t.isEmpty()) return emptyList()
        return Regex("<img\\b([^>]*)>").findAll(c).map { it.groupValues[1] }
            .filter { htmlLine(Regex("alt=\"([^\"]*)\"").first(it).orEmpty()) == t }
            .mapNotNull { Regex("data-lazy-src=\"([^\"]+)\"").first(it) ?: Regex("\\ssrc=\"(https:[^\"]+)\"").first(it) }
            .map(::htmlLine).distinct().mapNotNull { img(it, "$base/") }.toList()
    }
}

// ---------------------------------------------------------------- WEBTOON (resmi, Indonesia)
class Webtoon(private val http: StreamHttp) : MangaSource {
    override val key = "wt"; override val name = "WEBTOON"; override val lang = "id"; override val hasOrder = false
    private val ref = "http://www.webtoons.com"
    private val paths = ConcurrentHashMap<String, String>()
    private fun cover(u: String?) = img(u?.substringBefore('?'), ref)

    override suspend fun search(q: String): List<Manga> {
        val h = http.text("https://www.webtoons.com/id/search?keyword=${q.urlEncode()}")
        val anchors = Regex("<a href=\"(https://www\\.webtoons\\.com/(?:id|en)/([^\"]+?)/list\\?title_no=(\\d+))\"[^>]*class=\"link _card_item\"[^>]*data-webtoon-type=\"(\\w+)\"[^>]*>").findAll(h).toList()
        return anchors.mapIndexedNotNull { i, m ->
            val block = h.substring(m.range.last + 1, anchors.getOrNull(i + 1)?.range?.first ?: minOf(h.length, m.range.last + 3000))
            val title = htmlText(Regex("<strong class=\"title\">([\\s\\S]*?)</strong>").first(block)).ifEmpty { return@mapIndexedNotNull null }
            val id = "wt:${if (m.groupValues[4].equals("WEBTOON", true)) "w" else "c"}:${m.groupValues[3]}"
            paths[id] = m.groupValues[2]
            Manga(id, title, cover(Regex("<img[^>]+src=\"([^\"]+)\"").first(block)), name, lang, "Webtoon")
        }
    }

    override suspend fun browse(order: String, page: Int, type: String?): List<Manga> {
        if (page > 1) return emptyList()
        val h = http.text("https://www.webtoons.com/id/ranking/trending")
        return Regex("<a href=\"https://www\\.webtoons\\.com/id/([^\"]+?)/list\\?title_no=(\\d+)\"[^>]*data-webtoon-type=\"(\\w+)\"[^>]*>([\\s\\S]*?)</a>").findAll(h).mapNotNull { m ->
            val id = "wt:${if (m.groupValues[3].equals("WEBTOON", true)) "w" else "c"}:${m.groupValues[2]}"
            val title = htmlText(Regex("<strong class=\"title\">([\\s\\S]*?)</strong>").first(m.groupValues[4])).ifEmpty { return@mapNotNull null }
            paths[id] = m.groupValues[1]
            Manga(id, title, cover(Regex("<img[^>]+src=\"([^\"]+)\"").first(m.groupValues[4])), name, lang, "Webtoon")
        }.distinctBy { it.id }.toList()
    }

    override suspend fun detail(raw: String): MangaDetail {
        val (kind, no) = raw.split(':').let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "") }
        if (kind !in setOf("w", "c") || !no.all(Char::isDigit) || no.isEmpty()) throw SourceException("ID tidak valid")
        val id = "wt:$raw"
        val path = paths[id] ?: if (kind == "c") "canvas/a" else "a/a"
        val h = http.text("https://www.webtoons.com/id/$path/list?title_no=$no", mapOf("Referer" to "https://www.webtoons.com/"))
        val title = htmlText(Regex("<h1 class=\"subj\">([\\s\\S]*?)</h1>").first(h) ?: Regex("<meta property=\"og:title\" content=\"([^\"]+)\"").first(h) ?: raw)
        val chapters = mutableListOf<Chapter>()
        var cursor = ""
        repeat(30) {
            val j = http.json("https://m.webtoons.com/api/v1/${if (kind == "w") "webtoon" else "canvas"}/$no/episodes?pageSize=100" + (if (cursor.isNotEmpty()) "&cursor=${cursor.urlEncode()}" else ""), mapOf("Referer" to "https://m.webtoons.com/"))
            val r = j.optJSONObject("result") ?: j
            val eps = r.optJSONArray("episodeList").objects()
            eps.forEach { e -> e.str("viewerLink")?.let { chapters += Chapter("wt:/" + it.trimStart('/') + "/", null, e.str("episodeTitle"), e.optLong("exposureDateMillis").takeIf { t -> t > 0 }) } }
            cursor = r.str("nextCursor").orEmpty()
            if (cursor.isEmpty() || eps.isEmpty()) return@repeat
        }
        val sorted = chapters.sortedBy { it.at ?: 0 }.mapIndexed { i, c -> c.copy(number = (i + 1).toString()) }
        val manga = Manga(id, title, cover(Regex("<meta property=\"og:image\" content=\"([^\"]+)\"").first(h)), name, lang, "Webtoon")
        return MangaDetail(manga, htmlText(Regex("<meta property=\"og:description\" content=\"([^\"]*)\"").first(h)),
            listOfNotNull(htmlText(Regex("<h2 class=\"genre[^\"]*\">([\\s\\S]*?)</h2>").first(h)).ifEmpty { null }), null,
            Regex("<meta property=\"com-linewebtoon:webtoon:author\" content=\"([^\"]*)\"").first(h)?.ifEmpty { null }, sorted)
    }

    override suspend fun pages(raw: String): List<Img> {
        val h = http.text("https://www.webtoons.com/${raw.trim('/')}", mapOf("Referer" to "https://www.webtoons.com/"))
        val start = h.indexOf("id=\"_imageList\"").coerceAtLeast(0)
        return Regex("data-url=\"([^\"]+)\"").findAll(h.substring(start)).map { it.groupValues[1].replace("&amp;", "&") }
            .filter { "webtoon-phinf.pstatic.net" in it }.distinct().mapNotNull { img(it, ref) }.toList()
    }
}

// ---------------------------------------------------------------- MangaPark (Inggris)
class MangaPark(private val http: StreamHttp) : MangaSource {
    override val key = "mp"; override val name = "MangaPark"; override val lang = "en"; override val hasOrder = false
    private val base = "https://mangapark.cc"
    private fun abs(u: String?) = when { u == null -> null; u.startsWith("//") -> "https:$u"; u.startsWith("http") -> u; else -> base + (if (u.startsWith("/")) u else "/$u") }
    private fun unjson(s: String) = Regex("\\\\u([0-9a-fA-F]{4})").replace(s) { it.groupValues[1].toInt(16).toChar().toString() }.replace("\\/", "/").replace("\\\"", "\"")

    private fun list(h: String): List<Manga> {
        val out = LinkedHashMap<String, Manga>()
        Regex("\\{\"@type\":\"ListItem\",\"position\":\\d+,\"url\":\"https://mangapark\\.cc/manga/([^\"]+)\",\"name\":\"([^\"]+)\"\\}").findAll(h).forEach { m ->
            val slug = m.groupValues[1].split('/', '?')[0]
            if (slug.isNotEmpty() && slug !in out) out[slug] = Manga("mp:$slug", unjson(m.groupValues[2]), null, name, lang)
        }
        if (out.isEmpty()) Regex("href=\"/manga/([^\"/?#]+)\"[^>]*title=\"([^\"]+)\"").findAll(h).forEach { m ->
            if (m.groupValues[1] !in out) out[m.groupValues[1]] = Manga("mp:${m.groupValues[1]}", htmlLine(m.groupValues[2]), null, name, lang)
        }
        Regex("<a[^>]+href=\"/manga/([^\"/?#]+)\"[^>]*>([\\s\\S]*?)</a>").findAll(h).forEach { b ->
            val it = out[b.groupValues[1]] ?: return@forEach
            if (it.cover == null) Regex("<img[^>]+(?:data-src|src)=\"([^\"]+)\"").first(b.groupValues[2])?.let { c -> out[b.groupValues[1]] = it.copy(cover = img(abs(c), "$base/")) }
        }
        // Kartu bertanda jenis (Manga/Manhwa/Manhua/Novel): novel berisi teks berbayar, bukan komik, jadi dibuang.
        Regex("<div class=\"unit[^\"]*\">[\\s\\S]*?href=\"/manga/([^\"/?#]+)\"[\\s\\S]*?<span class=\"type\">([^<]+)</span>").findAll(h).forEach { u ->
            out[u.groupValues[1]]?.let { out[u.groupValues[1]] = it.copy(type = htmlLine(u.groupValues[2])) }
        }
        return out.values.filter { !(it.type ?: "").contains("novel", true) && !it.id.endsWith("-novel") }
    }

    override suspend fun browse(order: String, page: Int, type: String?) = list(http.text("$base/search?page=$page", mapOf("Referer" to "$base/")))
    override suspend fun search(q: String) = list(http.text("$base/search?q=${q.urlEncode()}", mapOf("Referer" to "$base/")))

    override suspend fun detail(raw: String): MangaDetail {
        val slug = raw.substringBefore('|')
        val h = http.text("$base/manga/${slug.urlEncode()}", mapOf("Referer" to "$base/"))
        val ch = runCatching { http.text("$base/manga/${slug.urlEncode()}/chapters", mapOf("Referer" to "$base/")) }.getOrDefault("")
        val title = htmlText(Regex("property=\"og:title\"\\s+content=\"([^\"]+)\"").first(h) ?: slug).substringBefore(" - MangaPark").substringBefore(" |")
            .replace(Regex("\\s+(Manga|Manhwa|Manhua)?\\s*[–-]\\s*Read Online.*$", RegexOption.IGNORE_CASE), "").trim()
        val chapters = mutableListOf<Chapter>()
        Regex("<li[^>]*class=\"[^\"]*item[^\"]*\"[^>]*data-number=\"([^\"]*)\"[^>]*>[\\s\\S]*?<a[^>]+href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>[\\s\\S]*?</li>").findAll(ch).forEach { m ->
            val lang = Regex("class=\"[^\"]*flag\\s+([A-Z]{2})").first(m.groupValues[3])?.lowercase() ?: "en"
            if (lang != "en") return@forEach
            val label = Regex("<span[^>]*>([\\s\\S]*?)</span>").first(m.groupValues[3])?.let(::htmlText).orEmpty().replace(Regex("^[A-Z]{2}\\s*"), "")
            chapters += Chapter("mp:$slug|${m.groupValues[2]}", m.groupValues[1].ifEmpty { null } ?: chapterNum(Regex("chapter[ -]*([\\d.]+)", RegexOption.IGNORE_CASE).first(m.groupValues[2])),
                label.replace(Regex("^Chapter\\s*[\\d.]+[:\\s-]*", RegexOption.IGNORE_CASE), "").trim().ifEmpty { null })
        }
        if (chapters.isEmpty()) Regex("href=\"(/read/[^\"]+chapter[^\"]*)\"[^>]*>", RegexOption.IGNORE_CASE).findAll(ch).forEach { m ->
            chapters += Chapter("mp:$slug|${m.groupValues[1]}", chapterNum(Regex("chapter[ -]*([\\d.]+)", RegexOption.IGNORE_CASE).first(m.groupValues[1])), null)
        }
        val st = when {
            Regex("status[^<]{0,80}Completed", RegexOption.IGNORE_CASE).containsMatchIn(h) -> "Tamat"
            Regex("status[^<]{0,80}(Ongoing|Releasing)", RegexOption.IGNORE_CASE).containsMatchIn(h) -> "Ongoing"
            else -> null
        }
        val manga = Manga("mp:$slug", title, img(abs(Regex("property=\"og:image\"\\s+content=\"([^\"]+)\"").first(h)), "$base/"), name, lang, "Manga",
            altTitles = Regex("\"([^\"]+)\"").findAll(Regex("\"alternateName\"\\s*:\\s*\\[([^\\]]*)]").first(h).orEmpty()).map { unjson(it.groupValues[1]) }.toList())
        return MangaDetail(manga, htmlText(Regex("property=\"og:description\"\\s+content=\"([^\"]+)\"").first(h)),
            Regex("/genre/([^\"?]+)\"").findAll(h).map { it.groupValues[1].replace('-', ' ').split(' ').joinToString(" ") { w -> w.replaceFirstChar(Char::uppercase) } }.distinct().take(12).toList(),
            st, Regex("class=\"[^\"]*author[^\"]*\"[^>]*>[\\s\\S]*?<a[^>]*>([\\s\\S]*?)</a>").first(h)?.let(::htmlText)?.ifEmpty { null }, tidyChapters(chapters))
    }

    override suspend fun pages(raw: String): List<Img> {
        val path = raw.substringAfter('|', "")
        if (!path.startsWith("/")) return emptyList()
        val h = http.text(base + path, mapOf("Referer" to "$base/"))
        val sec = Regex("<section[^>]*class=\"[^\"]*chapter-reader[^\"]*\"[^>]*>([\\s\\S]*?)</section>").first(h) ?: h
        var imgs = Regex("<img[^>]+(?:data-src|src)=\"([^\"]+)\"").findAll(sec).mapNotNull { abs(it.groupValues[1]) }
            .filter { Regex("\\.(jpe?g|png|webp)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(it) && !Regex("logo|icon|avatar|no-cover").containsMatchIn(it) }.toList()
        if (imgs.isEmpty()) imgs = Regex("https?://[^\"'\\s\\\\>]+/storage/chapters/[^\"'\\s\\\\<]+\\.(?:jpe?g|png|webp)", RegexOption.IGNORE_CASE).findAll(h).map { it.value.replace("\\/", "/") }.toList()
        return imgs.distinct().mapNotNull { img(it, "$base/") }
    }
}

// ---------------------------------------------------------------- MangaGoku (Inggris, jaringan MangaKakalot)
class MangaGoku(private val http: StreamHttp) : MangaSource {
    override val key = "kk"; override val name = "MangaGoku"; override val lang = "en"
    private val base = "https://www.mangagoku.com"
    private fun cover(u: String?) = img(u?.let { when { it.startsWith("//") -> "https:$it"; it.startsWith("http") -> it; else -> base + it } }, "$base/")

    private fun list(h: String): List<Manga> {
        val covers = HashMap<String, String>()
        Regex("<img src=\"([^\"]+)\" alt=\"([^\"]*)\"").findAll(h).forEach { covers.putIfAbsent(htmlLine(it.groupValues[2]), it.groupValues[1]) }
        return Regex("<a title=\"([^\"]+)\"[^>]*href=\"/manga/([a-z0-9-]+)\"").findAll(h).map { m ->
            val title = htmlLine(m.groupValues[1])
            Manga("kk:${m.groupValues[2]}", title, cover(covers[title]), name, lang)
        }.distinctBy { it.id }.toList()
    }

    override suspend fun browse(order: String, page: Int, type: String?) =
        list(http.text("$base/manga-list/${if (order == "latest") "latest-manga" else "hot-manga"}?page=$page", mapOf("Referer" to "$base/")))
    override suspend fun search(q: String) = list(http.text("$base/search?q=${q.urlEncode()}", mapOf("Referer" to "$base/")))

    override suspend fun detail(raw: String): MangaDetail {
        val slug = raw.substringBefore('|')
        if (!Regex("^[a-z0-9-]+$").matches(slug)) throw SourceException("ID tidak valid")
        val h = http.text("$base/manga/$slug", mapOf("Referer" to "$base/"))
        val api = runCatching { http.json("$base/api/manga/$slug/chapters?limit=5000", mapOf("Referer" to "$base/manga/$slug")) }.getOrNull()
        val info = Regex("text-white/45\">([^<]+)</span><span[^>]*>([\\s\\S]*?)</span></div>").findAll(h).associate { it.groupValues[1].trim().lowercase() to htmlText(it.groupValues[2]) }
        val chapters = api?.optJSONObject("data")?.optJSONArray("chapters").objects().filter { it.str("chapter_slug") != null }.map { c ->
            Chapter("kk:$slug|${c.str("chapter_slug")}", c.opt("chapter_num")?.takeIf { it != JSONObject.NULL }?.toString()?.let(::chapterNum) ?: chapterNum(c.str("chapter_slug")),
                c.optString("chapter_name").replace(Regex("^Chapter\\s*[\\d.]+[:\\s-]*", RegexOption.IGNORE_CASE), "").trim().ifEmpty { null })
        }
        val manga = Manga("kk:$slug", htmlText(Regex("<meta property=\"og:title\" content=\"([^\"]+)\"").first(h) ?: slug).substringBefore(" | "),
            cover(Regex("<meta property=\"og:image\" content=\"([^\"]+)\"").first(h)), name, lang, "Manga")
        return MangaDetail(manga, "", Regex("href=\"/genre/([a-z0-9-]+)\"[^>]*>([^<]+)<").findAll(h).filter { it.groupValues[1] != "all" }.map { htmlLine(it.groupValues[2]) }.distinct().toList(),
            cleanStatus(info["status"]), info["author"]?.ifEmpty { null }, tidyChapters(chapters))
    }

    override suspend fun pages(raw: String): List<Img> {
        val slug = raw.substringBefore('|')
        val ch = raw.substringAfter('|', "")
        if (!Regex("^[a-z0-9-]+$").matches(slug) || !Regex("^[a-z0-9._-]+$", RegexOption.IGNORE_CASE).matches(ch)) return emptyList()
        val h = http.text("$base/manga/$slug/$ch", mapOf("Referer" to "$base/manga/$slug"))
        return Regex("https://[a-z0-9.-]+/[^\"'\\s\\\\]+\\.(?:webp|jpe?g|png)", RegexOption.IGNORE_CASE).findAll(h).map { it.value }
            .filter { "/$slug/" in it && "/thumb/" !in it }.distinct().mapNotNull { img(it, "$base/") }.toList()
    }
}
