package com.freease.music.stream.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Galat sumber yang pesannya boleh ditampilkan apa adanya ke pengguna. */
class SourceException(message: String) : IOException(message)

const val UA_DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
const val UA_MOBILE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36"

/** Pengambil halaman/JSON untuk Freease Stream: UA browser, batas waktu, dan deteksi tantangan Cloudflare. */
class StreamHttp(base: OkHttpClient) {
    val client: OkHttpClient = base.newBuilder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    suspend fun text(url: String, headers: Map<String, String> = emptyMap(), ua: String = UA_DESKTOP): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", ua).header("Accept-Language", "id-ID,id;q=0.9,en;q=0.8")
        headers.forEach { (k, v) -> req.header(k, v) }
        exec(req.build())
    }

    suspend fun json(url: String, headers: Map<String, String> = emptyMap()): JSONObject =
        parse(text(url, headers + ("Accept" to "application/json"))) as? JSONObject ?: throw SourceException("Jawaban sumber tidak terbaca")

    suspend fun jsonAny(url: String, headers: Map<String, String> = emptyMap()): Any =
        parse(text(url, headers + ("Accept" to "application/json")))

    suspend fun postForm(url: String, form: Map<String, String>, headers: Map<String, String> = emptyMap()): String = withContext(Dispatchers.IO) {
        val body = FormBody.Builder().apply { form.forEach { (k, v) -> add(k, v) } }.build()
        val req = Request.Builder().url(url).post(body).header("User-Agent", UA_DESKTOP)
        headers.forEach { (k, v) -> req.header(k, v) }
        exec(req.build())
    }

    private fun exec(req: Request): String {
        val res = try { client.newCall(req).execute() } catch (e: IOException) { throw SourceException("Sumber tidak bisa dihubungi") }
        res.use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw SourceException(if (r.code == 404) "Tidak ditemukan di sumber" else "Sumber menolak (HTTP ${r.code})")
            if ("<title>Just a moment...</title>" in body) throw SourceException("Sumber sedang memblokir (Cloudflare)")
            return body
        }
    }

    private fun parse(s: String): Any = try {
        if (s.trimStart().startsWith("[")) JSONArray(s) else JSONObject(s)
    } catch (e: Exception) { throw SourceException("Jawaban sumber tidak terbaca") }
}

/** Cache TTL kecil di memori; permintaan yang sama tidak dikirim dua kali selama masih segar. */
class TtlCache(private val max: Int = 300) {
    private class Entry(val value: Any?, val exp: Long)
    private val map = ConcurrentHashMap<String, Entry>()

    @Suppress("UNCHECKED_CAST")
    suspend fun <T> get(key: String, ttlMs: Long, load: suspend () -> T): T {
        map[key]?.let { if (it.exp > System.currentTimeMillis()) return it.value as T }
        val v = load()
        if (map.size >= max) map.keys.firstOrNull()?.let(map::remove)
        map[key] = Entry(v, System.currentTimeMillis() + ttlMs)
        return v
    }
}

private val NAMED = mapOf("amp" to "&", "quot" to "\"", "lt" to "<", "gt" to ">", "nbsp" to " ", "apos" to "'", "rsquo" to "’", "lsquo" to "‘",
    "ldquo" to "“", "rdquo" to "”", "hellip" to "…", "ndash" to "–", "mdash" to "—", "laquo" to "«", "raquo" to "»")
private val ENTITY = Regex("&(#x[0-9a-fA-F]+|#\\d+|[a-zA-Z]+);")

fun decodeEntities(s: String?): String = ENTITY.replace(s.orEmpty()) { m ->
    val v = m.groupValues[1]
    when {
        v.startsWith("#x") || v.startsWith("#X") -> v.drop(2).toIntOrNull(16)?.takeIf { it in 1..0x10FFFF }?.let { String(Character.toChars(it)) } ?: m.value
        v.startsWith("#") -> v.drop(1).toIntOrNull()?.takeIf { it in 1..0x10FFFF }?.let { String(Character.toChars(it)) } ?: m.value
        else -> NAMED[v.lowercase()] ?: m.value
    }
}

/** Fragmen HTML → teks: <br> jadi baris baru, tag dibuang, spasi dirapikan. */
fun htmlText(s: String?): String = decodeEntities(
    s.orEmpty().replace(Regex("\\s*<br\\s*/?>\\s*", RegexOption.IGNORE_CASE), "\n").replace(Regex("</p>\\s*<p[^>]*>", RegexOption.IGNORE_CASE), "\n\n").replace(Regex("<[^>]+>"), ""),
).lines().joinToString("\n") { it.replace(Regex("[ \\t]+"), " ").trim() }.replace(Regex("\n{3,}"), "\n\n").trim()

fun htmlLine(s: String?): String = htmlText(s).replace(Regex("\\s+"), " ")

/** Judul diringkas ke huruf+angka kecil, supaya "Mu Shen Ji" = "Mushen Ji!". */
fun titleKey(s: String?): String = s.orEmpty().lowercase().filter { it.isLetterOrDigit() }

fun sameTitle(a: String?, b: String?, alts: List<String> = emptyList()): Boolean {
    val want = titleKey(a)
    if (want.isEmpty()) return false
    return titleKey(b) == want || (want.length >= 5 && alts.any { titleKey(it) == want })
}

fun Regex.first(s: String, group: Int = 1): String? = find(s)?.groupValues?.getOrNull(group)

fun String.urlEncode(): String = java.net.URLEncoder.encode(this, "UTF-8")

fun JSONObject.str(key: String): String? = if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() && it != "null" } else null

fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
