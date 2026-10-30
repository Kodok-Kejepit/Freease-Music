package com.freease.music.data.lyrics.align

import com.freease.music.data.youtube.YouTubeRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.File
import java.io.IOException

/** Hasil penyelarasan otomatis. */
sealed interface AutoSyncResult {
    class Aligned(val map: AlignmentMap) : AutoSyncResult

    /** Audio video bukan rekaman yang sama dengan acuan (live, cover, versi lain). Jangan dicoba lagi. */
    data object NotMatching : AutoSyncResult

    /** Gagal sementara (jaringan, dsb.); boleh dicoba lagi nanti. */
    class Error(val cause: Throwable) : AutoSyncResult
}

/**
 * Menyelaraskan waktu lirik dari rekaman acuan (versi lagu resmi) ke video yang diputar dengan
 * mencocokkan suaranya. Audio diambil versi paling hemat (±50 kbps, ±1,5 MB per lagu), atau dari
 * berkas unduhan kalau videonya sudah diunduh. Satu proses sekaligus supaya HP tidak terbebani.
 */
class LyricsAutoSync(
    private val youtube: YouTubeRepository,
    private val client: OkHttpClient,
    private val tmpDir: File,
    private val downloadedFile: suspend (String) -> File?,
) {
    private val gate = Mutex()

    suspend fun align(videoId: String, refId: String, lyricsRangeMs: LongRange): AutoSyncResult = gate.withLock {
        try {
            val video = features(videoId)
            val ref = features(refId)
            val map = withContext(Dispatchers.Default) { Aligner.align(ref, video, lyricsRangeMs) }
            if (map == null) AutoSyncResult.NotMatching else AutoSyncResult.Aligned(map)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: TooLongException) {
            AutoSyncResult.NotMatching
        } catch (e: Exception) {
            AutoSyncResult.Error(e)
        }
    }

    private class TooLongException : IOException("Audio terlalu panjang untuk diselaraskan")

    private suspend fun features(id: String): AudioFeatures {
        downloadedFile(id)?.takeIf { it.exists() }?.let { local ->
            return withContext(Dispatchers.Default) { decode(local) }
        }
        val info = youtube.streamInfo(id)
        if (info.song.durationSec > MAX_SEC) throw TooLongException()
        val stream = youtube.pickAlignmentAudio(info) ?: throw IOException("Tidak ada stream audio")
        tmpDir.mkdirs()
        val file = File(tmpDir, "$id.${if (stream.mimeType?.contains("webm") == true) "webm" else "m4a"}")
        try {
            withContext(Dispatchers.IO) { fetch(stream.url, file) }
            return withContext(Dispatchers.Default) { decode(file) }
        } catch (e: IOException) {
            // URL stream bisa kedaluwarsa; ambil ulang lain kali.
            youtube.invalidate(id)
            throw e
        } finally {
            file.delete()
        }
    }

    private suspend fun decode(file: File): AudioFeatures {
        val ctx = currentCoroutineContext()
        return AudioDecoder.features(file) { ctx.isActive }
    }

    /** Unduh per potongan (YouTube memperlambat rentang besar). */
    private suspend fun fetch(url: String, file: File) {
        try {
            com.freease.music.util.RangedDownload.fetch(client, url, file, MAX_BYTES)
        } catch (e: com.freease.music.util.RangedDownload.TooLargeException) {
            throw TooLongException()
        }
    }

    private companion object {
        const val MAX_BYTES = 12L * 1024 * 1024
        const val MAX_SEC = 15 * 60
    }
}
