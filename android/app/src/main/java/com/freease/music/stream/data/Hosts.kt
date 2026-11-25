package com.freease.music.stream.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URI

/**
 * Server video yang memutar HLS (m3u8) di balik pemutar berisi iklan: VidHide, Streamruby, Mecdn (JS terkemas),
 * Vidara (API stream), Dailymotion (metadata), D-Tube. Daftar putarnya dibuka di HP lalu diputar ExoPlayer langsung,
 * tanpa iklan. Tiap hasil diperiksa: master m3u8 harus benar-benar terbaca. Sama dengan server/src/fuwa/hosts.js.
 */
class Hosts(private val http: StreamHttp) {

    suspend fun resolve(url: String, label: String, quality: String): List<VideoSource> {
        val uri = runCatching { URI(url) }.getOrNull() ?: return emptyList()
        val h = uri.host.orEmpty()
        return when {
            Regex("(^|\\.)nunadrama\\.").containsMatchIn(h) || h.endsWith("dailymotion.com") -> {
                val id = Regex("[?&]video=([a-z0-9]+)", RegexOption.IGNORE_CASE).first(url)
                    ?: Regex("/(?:video|embed/video)/([a-z0-9]+)", RegexOption.IGNORE_CASE).first(uri.path.orEmpty())
                id?.let { dailymotion(it, label, quality) }.orEmpty()
            }
            Regex("(^|\\.)d\\.tube$").containsMatchIn(h) ->
                dtube(Regex("[?&]v=([a-z0-9-]+)", RegexOption.IGNORE_CASE).first(url) ?: uri.path.orEmpty().trim('/').substringAfterLast('/'), label, quality)
            Regex("vidara|oisauh").containsMatchIn(h) -> vidara(uri, label, quality)
            else -> packedPage(url, label, quality)
        }
    }

    /** Periksa master/daftar m3u8 lalu jadikan sumber HLS; kualitas = resolusi tertinggi di master. */
    private suspend fun hlsSource(m3u8: String, referer: String, label: String, quality: String): List<VideoSource> {
        val headers = mapOf("Referer" to referer, "Origin" to referer.trimEnd('/'))
        val text = http.text(m3u8, headers)
        if (!text.trimStart().startsWith("#EXTM3U")) return emptyList()
        val heights = Regex("RESOLUTION=\\d+x(\\d+)").findAll(text).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()
        val q = heights.maxOrNull()?.let { "${it}p" } ?: quality.ifEmpty { "Auto" }
        return listOf(VideoSource(label, q, m3u8, headers, hls = true))
    }

    private suspend fun packedPage(url: String, label: String, quality: String): List<VideoSource> {
        val html = http.text(url)
        val origin = runCatching { URI(url).let { "${it.scheme}://${it.host}/" } }.getOrDefault("")
        val blobs = listOf(html) + Regex("eval\\(function\\(p,a,c,k,e,d\\)[\\s\\S]*?\\.split\\('\\|'\\)[^)]*\\)\\)").findAll(html).map { unpack(it.value).orEmpty() }
        for (b in blobs) {
            val s = decodeEntities(b).replace("\\/", "/")
            val found = Regex("\"hls\\d\"\\s*:\\s*\"(https:[^\"]+\\.m3u8[^\"]*)\"").first(s)
                ?: Regex("file\\s*:\\s*[\"']([^\"']+\\.m3u8[^\"']*)[\"']").first(s)
                ?: Regex("sources\\s*:\\s*\\[\\s*\\{\\s*(?:src|file)\\s*:\\s*[\"']([^\"']+\\.m3u8[^\"']*)").first(s)
                ?: Regex("https://[^\"'\\s<>\\\\]+\\.m3u8[^\"'\\s<>\\\\]*").first(s, 0)
            if (found != null) return hlsSource(if (found.startsWith("http")) found else URI(url).resolve(found).toString(), origin, label, quality)
            Regex("file\\s*:\\s*[\"'](https?:[^\"']+\\.mp4[^\"']*)[\"']").first(s)?.let { mp4 ->
                return listOf(VideoSource(label, quality.ifEmpty { "Auto" }, mp4, mapOf("Referer" to origin)))
            }
        }
        return emptyList()
    }

    private suspend fun vidara(uri: URI, label: String, quality: String): List<VideoSource> {
        val code = Regex("/[ev]/([A-Za-z0-9]+)").first(uri.path.orEmpty()) ?: return emptyList()
        val origin = "${uri.scheme}://${uri.host}"
        val body = JSONObject().put("filecode", code).put("device", "android").put("codecs", org.json.JSONArray()).toString()
        val text = withContext(Dispatchers.IO) {
            val req = Request.Builder().url("$origin/api/stream").post(body.toRequestBody("application/json".toMediaType()))
                .header("User-Agent", UA_DESKTOP).header("Accept-Language", "id-ID,id;q=0.9,en;q=0.8").header("Referer", uri.toString()).build()
            http.client.newCall(req).execute().use { if (it.isSuccessful) it.body?.string().orEmpty() else "" }
        }
        val m3u8 = runCatching { JSONObject(text).str("streaming_url") }.getOrNull() ?: return emptyList()
        return hlsSource(m3u8, "$origin/", label, quality)
    }

    private suspend fun dailymotion(id: String, label: String, quality: String): List<VideoSource> {
        val j = http.json("https://www.dailymotion.com/player/metadata/video/$id", mapOf("Referer" to "https://geo.dailymotion.com/"))
        val auto = j.optJSONObject("qualities")?.optJSONArray("auto").objects()
        val m3u8 = auto.firstOrNull { "mpegurl" in it.optString("type").lowercase() }?.str("url") ?: return emptyList()
        return hlsSource(m3u8, "https://www.dailymotion.com/", label, quality)
    }

    private suspend fun dtube(id: String, label: String, quality: String): List<VideoSource> {
        if (!Regex("^[a-z0-9-]{8,64}$", RegexOption.IGNORE_CASE).matches(id)) return emptyList()
        for (nas in listOf("https://nas1.d.tube", "https://nas2.d.tube")) {
            val out = runCatching { hlsSource("$nas/videos/$id/master.m3u8", "https://play.d.tube/", label, quality) }.getOrDefault(emptyList())
            if (out.isNotEmpty()) return out
        }
        return emptyList()
    }

    companion object {
        /** Buka JS terkemas `eval(function(p,a,c,k,e,d)…)` (Dean Edwards packer). */
        fun unpack(src: String): String? {
            val m = Regex("\\}\\('(.*)',\\s*(\\d+),\\s*(\\d+),\\s*'(.*?)'\\.split\\('\\|'\\)", RegexOption.DOT_MATCHES_ALL).find(src) ?: return null
            val p = m.groupValues[1]
            val a = m.groupValues[2].toIntOrNull() ?: return null
            var c = m.groupValues[3].toIntOrNull() ?: return null
            val k = m.groupValues[4].split('|')
            if (a !in 2..62 || c > 50000) return null
            fun enc(n: Int): String {
                val r = n % a
                val ch = if (r > 35) (r + 29).toChar().toString() else r.toString(36)
                return (if (n < a) "" else enc(n / a)) + ch
            }
            val dict = HashMap<String, String>()
            while (c-- > 0) dict[enc(c)] = k.getOrNull(c)?.takeIf { it.isNotEmpty() } ?: enc(c)
            return Regex("\\b\\w+\\b").replace(p) { dict[it.value] ?: it.value }.replace("\\'", "'")
        }
    }
}
