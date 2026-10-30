package com.freease.music.playback

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Bagian non-musik di video klip (intro ngobrol, adegan tambahan, outro) dari basis data komunitas
 * SponsorBlock, kategori "music_offtopic". Yang dikirim hanya 4 huruf awal hash id video, jadi server
 * tidak tahu lagu apa yang diputar.
 */
class NonMusicSkipper(private val client: OkHttpClient) {
    /** Satu bagian yang dilewati (milidetik); [videoMs] = panjang video saat bagian itu ditandai. */
    data class Segment(val startMs: Long, val endMs: Long, val videoMs: Long)

    private val cache = ConcurrentHashMap<String, List<Segment>>()

    suspend fun segments(videoId: String): List<Segment> {
        cache[videoId]?.let { return it }
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val prefix = sha256(videoId).take(4)
                val url = "https://sponsor.ajay.app/api/skipSegments/$prefix?categories=%5B%22music_offtopic%22%5D&actionTypes=%5B%22skip%22%5D"
                client.newCall(Request.Builder().url(url).build()).execute().use { r ->
                    if (r.code == 404) return@runCatching emptyList()
                    if (!r.isSuccessful) error("HTTP ${r.code}")
                    parse(r.body?.string().orEmpty(), videoId)
                }
            }.getOrNull()
        }
        if (result != null) cache[videoId] = result
        return result.orEmpty()
    }

    companion object {
        fun parse(json: String, videoId: String): List<Segment> {
            val arr = JSONArray(json)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                if (o.optString("videoID") != videoId) continue
                val segs = o.getJSONArray("segments")
                return (0 until segs.length()).map { segs.getJSONObject(it) }
                    .filter { it.optString("category") == "music_offtopic" }
                    .map {
                        val se = it.getJSONArray("segment")
                        Segment((se.getDouble(0) * 1000).toLong(), (se.getDouble(1) * 1000).toLong(), (it.optDouble("videoDuration", 0.0) * 1000).toLong())
                    }
                    .filter { it.endMs - it.startMs >= 1_000 }
                    .sortedBy { it.startMs }
            }
            return emptyList()
        }

        /**
         * Bagian yang sedang dilewati di [positionMs], atau null. Bagian diabaikan kalau panjang video
         * berbeda jauh (> 3 dtk) dari saat ditandai — berarti versinya lain.
         */
        fun active(segments: List<Segment>, positionMs: Long, durationMs: Long): Segment? = segments.firstOrNull { s ->
            (s.videoMs <= 0 || durationMs <= 0 || kotlin.math.abs(s.videoMs - durationMs) <= 3_000) &&
                positionMs >= s.startMs && positionMs < s.endMs - 500
        }

        private fun sha256(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
