package com.freease.music.stream.data

import android.graphics.BitmapFactory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.Request
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Kotak teks dalam pecahan ukuran gambar (0..1), sudah diterjemahkan ke bahasa Indonesia. */
data class Bubble(val x: Float, val y: Float, val w: Float, val h: Float, val text: String)

/**
 * Terjemahan komik di HP sendiri: teks di gambar dibaca ML Kit (di perangkat, tanpa akun & tanpa kuota), baris yang
 * berdekatan disatukan jadi satu balon kata, lalu diterjemahkan lewat Google Translate publik (tanpa kunci).
 * Cocok untuk komik berhuruf Latin (Inggris); hasil per halaman disimpan di memori.
 */
class PageTranslator(private val http: StreamHttp) {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private val done = ConcurrentHashMap<String, List<Bubble>>()
    private val lock = Mutex()

    suspend fun translate(page: Img): List<Bubble> {
        done[page.url]?.let { return it }
        return lock.withLock {
            done[page.url] ?: run {
                val bytes = withContext(Dispatchers.IO) {
                    val req = Request.Builder().url(page.url).header("User-Agent", UA_DESKTOP).apply { page.referer?.let { header("Referer", it) } }.build()
                    http.client.newCall(req).execute().use { it.body?.bytes() ?: ByteArray(0) }
                }
                val bmp = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } ?: throw SourceException("Gambar tidak terbaca")
                val result = suspendCancellableCoroutine { cont ->
                    recognizer.process(InputImage.fromBitmap(bmp, 0))
                        .addOnSuccessListener { cont.resume(it) }
                        .addOnFailureListener { cont.resumeWithException(it) }
                }
                val W = bmp.width.toFloat(); val H = bmp.height.toFloat()
                data class Line(var x0: Int, var y0: Int, var x1: Int, var y1: Int, var text: String, var n: Int = 1)
                val lines = result.textBlocks.flatMap { it.lines }.mapNotNull { l ->
                    val b = l.boundingBox ?: return@mapNotNull null
                    val t = l.text.trim()
                    val letters = t.count { it.isLetter() }
                    if (letters < 2 || letters.toFloat() / t.count { !it.isWhitespace() }.coerceAtLeast(1) < 0.6f || b.height() > H * 0.2f) null
                    else Line(b.left, b.top, b.right, b.bottom, t)
                }.sortedBy { it.y0 }
                val groups = mutableListOf<Line>()
                for (l in lines) {
                    val lh = l.y1 - l.y0
                    val g = groups.firstOrNull { g ->
                        val overlap = minOf(g.x1, l.x1) - maxOf(g.x0, l.x0)
                        l.y0 - g.y1 < lh * 1.1f && l.y0 >= g.y0 && overlap > minOf(g.x1 - g.x0, l.x1 - l.x0) * 0.3f
                    }
                    if (g != null) { g.x0 = minOf(g.x0, l.x0); g.x1 = maxOf(g.x1, l.x1); g.y1 = maxOf(g.y1, l.y1); g.text += " " + l.text; g.n++ } else groups += l
                }
                val texts = groups.map { tidy(it.text) }
                val out = gtx(texts)
                groups.mapIndexedNotNull { i, g ->
                    val t = out.getOrNull(i)?.trim().orEmpty().ifEmpty { texts[i] }
                    if (t.isBlank()) null else Bubble(g.x0 / W, g.y0 / H, (g.x1 - g.x0) / W, (g.y1 - g.y0) / H, t)
                }.also { done[page.url] = it }
            }
        }
    }

    /** Huruf kapital semua (gaya teks komik) jadi kalimat biasa supaya terjemahannya lebih wajar. */
    private fun tidy(s: String): String {
        val t = s.split(Regex("\\s+")).filter { w -> w.any { it.isLetterOrDigit() } || w.matches(Regex("[.!?…]+")) }.joinToString(" ")
            .replace(Regex("-\\s+(?=\\p{Ll})"), "").trim()
        val letters = t.filter { it.isLetter() }
        if (letters.isNotEmpty() && letters == letters.uppercase() && letters != letters.lowercase()) {
            return Regex("(^|[.!?]\\s+)(\\p{L})").replace(t.lowercase()) { it.groupValues[1] + it.groupValues[2].uppercase() }.replace(Regex("\\bi\\b"), "I")
        }
        return t
    }

    private suspend fun gtx(lines: List<String>): List<String> {
        if (lines.isEmpty()) return emptyList()
        val body = withContext(Dispatchers.IO) {
            val req = Request.Builder().url("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=id&dt=t")
                .post(FormBody.Builder().add("q", lines.joinToString("\n")).build()).build()
            http.client.newCall(req).execute().use { if (!it.isSuccessful) throw SourceException("Terjemahan gagal"); it.body?.string().orEmpty() }
        }
        val parts = JSONArray(body).optJSONArray(0) ?: return lines
        val text = (0 until parts.length()).joinToString("") { parts.optJSONArray(it)?.optString(0).orEmpty() }
        val split = text.split("\n")
        return if (split.size == lines.size) split else lines.map { l -> runCatching { gtx(listOf(l)).first() }.getOrDefault(l) }
    }
}
