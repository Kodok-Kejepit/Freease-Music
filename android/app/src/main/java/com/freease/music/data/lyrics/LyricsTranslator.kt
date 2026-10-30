package com.freease.music.data.lyrics

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/** Terjemahan per baris lirik; [lines][i] = null kalau baris itu tidak perlu/tidak bisa diterjemahkan. */
class LyricsTranslation(val lines: List<String?>, val sourceLang: String?) {
    /** Lirik sudah berbahasa tujuan — tidak ada yang ditampilkan. */
    val alreadyTarget: Boolean get() = lines.all { it == null }
}

/**
 * Menerjemahkan lirik ke Bahasa Indonesia (Google Terjemahan, tanpa kunci API). Baris dikirim
 * berkelompok (dipisah baris baru) supaya cukup 1–2 permintaan per lagu, lalu disimpan per lagu.
 */
class LyricsTranslator(private val client: OkHttpClient, private val dir: File, private val target: String = "id") {
    private val lock = Mutex()
    private val memory = HashMap<String, LyricsTranslation>()

    suspend fun translate(songId: String, lines: List<String>): LyricsTranslation = lock.withLock {
        val key = "${songId}_${lines.joinToString("\n").hashCode()}"
        memory[key]?.let { return@withLock it }
        val file = File(dir, "${key.replace(Regex("[^A-Za-z0-9_-]"), "_")}.json")
        load(file, lines.size)?.let { memory[key] = it; return@withLock it }
        val result = withContext(Dispatchers.IO) { fetch(lines) }
        memory[key] = result
        runCatching { dir.mkdirs(); save(file, result) }
        result
    }

    private fun fetch(lines: List<String>): LyricsTranslation {
        val wanted = lines.map { it.trim() }.filter { needsTranslation(it) }.distinct()
        if (wanted.isEmpty()) return LyricsTranslation(lines.map { null }, null)
        val map = HashMap<String, String>()
        var source: String? = null
        for (batch in batches(wanted)) {
            val (text, src) = request(batch.joinToString("\n"))
            if (source == null) source = src
            if (src == target) return LyricsTranslation(lines.map { null }, src)
            val parts = text.split("\n")
            if (parts.size == batch.size) {
                batch.zip(parts).forEach { (a, b) -> map[a] = b.trim() }
            } else {
                // Jumlah baris berubah (penerjemah menggabung baris): ulangi satu per satu.
                batch.take(120).forEach { line -> runCatching { map[line] = request(line).first.trim() } }
            }
        }
        return LyricsTranslation(
            lines.map { l ->
                val t = map[l.trim()]
                t?.takeIf { it.isNotBlank() && !it.equals(l.trim(), ignoreCase = true) }
            },
            source,
        )
    }

    private fun batches(lines: List<String>): List<List<String>> {
        val out = ArrayList<List<String>>()
        var cur = ArrayList<String>()
        var len = 0
        for (l in lines) {
            if (len + l.length + 1 > MAX_CHARS && cur.isNotEmpty()) {
                out += cur; cur = ArrayList(); len = 0
            }
            cur += l; len += l.length + 1
        }
        if (cur.isNotEmpty()) out += cur
        return out
    }

    private fun request(text: String): Pair<String, String?> {
        val url = "https://translate.googleapis.com/translate_a/single".toHttpUrl().newBuilder()
            .addQueryParameter("client", "gtx")
            .addQueryParameter("sl", "auto")
            .addQueryParameter("tl", target)
            .addQueryParameter("dt", "t")
            .build()
        val body = okhttp3.FormBody.Builder().add("q", text).build()
        client.newCall(Request.Builder().url(url).post(body).build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Terjemahan gagal (${r.code})")
            return parse(r.body?.string().orEmpty())
        }
    }

    private fun load(f: File, size: Int): LyricsTranslation? = runCatching {
        if (!f.exists()) return null
        val o = JSONObject(f.readText())
        val arr = o.getJSONArray("l")
        if (arr.length() != size) return null
        LyricsTranslation((0 until arr.length()).map { if (arr.isNull(it)) null else arr.getString(it) }, o.optString("src").ifEmpty { null })
    }.getOrNull()

    private fun save(f: File, t: LyricsTranslation) {
        f.writeText(JSONObject().put("src", t.sourceLang ?: "").put("l", JSONArray(t.lines.map { it ?: JSONObject.NULL })).toString())
    }

    companion object {
        private const val MAX_CHARS = 4000

        /** Baris kosong, tanda jeda, atau hanya angka/simbol tidak perlu diterjemahkan. */
        fun needsTranslation(line: String): Boolean = line.isNotBlank() && line != "♪" && line.any { it.isLetter() }

        /** Balasan: [[["terjemahan","asli",…],…], null, "kode bahasa sumber", …]. */
        fun parse(json: String): Pair<String, String?> {
            val root = JSONArray(json)
            val segs = root.optJSONArray(0) ?: return "" to null
            val sb = StringBuilder()
            for (i in 0 until segs.length()) segs.optJSONArray(i)?.optString(0)?.let { sb.append(it) }
            return sb.toString() to root.optString(2).ifEmpty { null }
        }
    }
}
