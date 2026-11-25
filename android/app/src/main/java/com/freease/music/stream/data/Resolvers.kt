package com.freease.music.stream.data

import org.json.JSONObject
import java.net.URI

/**
 * Server video embed → berkas video yang bisa diputar ExoPlayer (tanpa pemutar situs lain, jadi tanpa iklan).
 * Di HP, tautan Blogger/OK.ru diminta oleh HP itu sendiri, jadi terikat ke IP HP dan langsung bisa diputar.
 * Pemutar yang tidak bisa dibuka tapi terbukti aman di sandbox (Abyss, Mecdn, MEGA) dikembalikan sebagai embed.
 */
class Resolvers(private val http: StreamHttp) {

    suspend fun resolve(url: String, label: String, quality: String = ""): List<VideoSource> {
        val u = url.trim()
        val host = runCatching { URI(u).host.orEmpty() }.getOrDefault("")
        val name = label.replace(Regex("\\[[^]]*]"), "").trim().ifEmpty { "Server" }
        return runCatching {
            when {
                host.endsWith("pixeldrain.com") -> pixeldrain(u, name, quality)
                host == "www.blogger.com" && "video.g" in u -> blogger(u, name, quality)
                host == "ok.ru" || host == "m.ok.ru" -> okru(u, name)
                host.endsWith("mp4upload.com") -> mp4upload(u, name, quality)
                host == "filedon.co" || host.endsWith(".filedon.co") -> filedon(u, name, quality)
                host.endsWith("desustream.net") -> desustream(u, name, quality)
                Regex("\\.(mp4|webm)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(u) && host.isNotEmpty() ->
                    listOf(VideoSource(name, qualityOf(quality, name, u), u))
                else -> embed(u, quality)
            }
        }.getOrElse { emptyList() }
    }

    private fun pixeldrain(u: String, label: String, q: String): List<VideoSource> {
        if ("/l/" in u) return emptyList()
        val id = Regex("pixeldrain\\.com/(?:u|api/file)/([A-Za-z0-9]+)").first(u) ?: return emptyList()
        return listOf(VideoSource(label, qualityOf(q, label, u), "https://pixeldrain.com/api/file/$id"))
    }

    private suspend fun blogger(u: String, label: String, q: String): List<VideoSource> {
        val html = decodeEntities(http.text(u)).replace("\\u0026", "&").replace("\\u003d", "=").replace("\\/", "/")
        val start = html.indexOf("streamingData").takeIf { it >= 0 } ?: return emptyList()
        val end = html.indexOf("serverAbrStreamingUrl", start)
        val seg = if (end > 0) html.substring(start, end) else html.substring(start)
        val out = LinkedHashMap<String, VideoSource>()
        for (m in Regex("https://[a-z0-9.-]+googlevideo\\.com/videoplayback\\?[^\"\\\\\\s]+").findAll(seg)) {
            val itag = Regex("[?&]itag=(\\d+)").first(m.value)?.toIntOrNull()
            val h = ITAG[itag]
            val key = h?.toString() ?: m.value
            if (key !in out) out[key] = VideoSource(label, h?.let { "${it}p" } ?: q.ifEmpty { "Auto" }, m.value)
        }
        return out.values.toList()
    }

    private suspend fun okru(u: String, label: String): List<VideoSource> {
        val id = Regex("(?:videoembed|video)/(\\d+)").first(u) ?: return emptyList()
        val html = http.text("https://ok.ru/videoembed/$id")
        val raw = Regex("data-options=\"([^\"]+)\"").first(html) ?: return emptyList()
        val o = JSONObject(decodeEntities(raw))
        val fv = o.optJSONObject("flashvars") ?: return emptyList()
        val md = fv.opt("metadata").let { if (it is String) JSONObject(it) else it as? JSONObject } ?: return emptyList()
        return md.optJSONArray("videos").objects().mapNotNull { v ->
            val h = OK_NAMES[v.optString("name")] ?: return@mapNotNull null
            val url = v.str("url") ?: return@mapNotNull null
            if (h < 360) null else VideoSource(label, "${h}p", url, mapOf("Referer" to "https://ok.ru/"))
        }
    }

    private suspend fun mp4upload(u: String, label: String, q: String): List<VideoSource> {
        val id = Regex("mp4upload\\.com/(?:embed-)?([a-z0-9]{8,16})", RegexOption.IGNORE_CASE).first(u) ?: return emptyList()
        val html = http.text("https://www.mp4upload.com/embed-$id.html", mapOf("Referer" to "https://www.mp4upload.com/"), UA_MOBILE)
        val src = Regex("src:\\s*\"(https://[^\"]+\\.mp4)\"").first(html) ?: return emptyList()
        return listOf(VideoSource(label, qualityOf(q, label, src), src, mapOf("Referer" to "https://www.mp4upload.com/")))
    }

    private suspend fun filedon(u: String, label: String, q: String): List<VideoSource> {
        val html = http.text(u)
        val data = decodeEntities(Regex("data-page=\"([^\"]+)\"").first(html)).replace("\\/", "/")
        val file = (Regex("\"url\":\"(https://[^\"]+\\.(?:mp4|mkv|webm)\\?[^\"]+)\"").first(data)
            ?: Regex("\"url\":\"(https://[^\"]+\\.mp4)\"").first(data))?.replace("\\u0026", "&") ?: return emptyList()
        return listOf(VideoSource(label, q.ifEmpty { "Auto" }, file))
    }

    private suspend fun desustream(u: String, label: String, q: String): List<VideoSource> {
        val t = decodeEntities(http.text(u, mapOf("Referer" to Otakudesu.BASE + "/")))
        Regex("https://[a-z0-9.-]+/[^\"'\\s<>]+\\.mp4[^\"'\\s<>]*", RegexOption.IGNORE_CASE).first(t, 0)?.let {
            return listOf(VideoSource(label, q.ifEmpty { "Auto" }, it, mapOf("Referer" to Otakudesu.BASE + "/")))
        }
        val gv = Regex("https://[a-z0-9.-]+googlevideo\\.com/videoplayback\\?[^\"'\\s<>]+").first(t, 0) ?: return emptyList()
        val h = ITAG[Regex("[?&]itag=(\\d+)").first(gv)?.toIntOrNull()]
        return listOf(VideoSource(label, h?.let { "${it}p" } ?: q.ifEmpty { "Auto" }, gv))
    }

    companion object {
        private val ITAG = mapOf(17 to 144, 18 to 360, 22 to 720, 34 to 360, 35 to 480, 36 to 240, 37 to 1080, 43 to 360, 59 to 480, 78 to 480)
        private val OK_NAMES = mapOf("full" to 1080, "hd" to 720, "sd" to 480, "low" to 360, "lowest" to 240, "mobile" to 144)

        /** Pemutar situs lain yang diuji jalan di dalam pembatas (tanpa pop-up, tanpa pindah halaman, tanpa unduhan). */
        val EMBED_HOSTS = listOf(
            "Abyss" to Regex("(^|\\.)abyssplayer\\.com$"),
            "Mecdn" to Regex("(^|\\.)mecdn\\.website$"),
            "MEGA" to Regex("^mega\\.nz$"),
        )

        fun embed(url: String, quality: String = ""): List<VideoSource> {
            val uri = runCatching { URI(url) }.getOrNull() ?: return emptyList()
            if (uri.scheme != "https") return emptyList()
            val host = uri.host.orEmpty()
            val name = EMBED_HOSTS.firstOrNull { it.second.containsMatchIn(host) }?.first ?: return emptyList()
            if (name == "MEGA" && !uri.path.orEmpty().startsWith("/embed/")) return emptyList()
            return listOf(VideoSource(name, quality.ifEmpty { "Auto" }, url, embed = true))
        }

        fun embedAllowed(host: String): Boolean = EMBED_HOSTS.any { it.second.containsMatchIn(host) }

        fun qualityOf(q: String?, label: String, url: String): String {
            val m = Regex("(\\d{3,4})").find(q.orEmpty())?.value
                ?: Regex("(\\d{3,4})\\s*p", RegexOption.IGNORE_CASE).first(label)
                ?: Regex("(\\d{3,4})p", RegexOption.IGNORE_CASE).first(url)
            return m?.let { "${it}p" } ?: "Auto"
        }

        /** Berkas langsung dulu (pemutar Freease sendiri), embed paling akhir; lalu kualitas tertinggi. */
        fun sort(list: List<VideoSource>): List<VideoSource> =
            list.distinctBy { it.url }.sortedWith(compareBy<VideoSource> { it.embed }.thenByDescending { it.height })
    }
}
