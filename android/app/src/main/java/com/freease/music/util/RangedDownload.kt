package com.freease.music.util

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

/** Unduhan stream googlevideo per potongan (YouTube memperlambat rentang besar). */
object RangedDownload {
    private const val CHUNK = 2L * 1024 * 1024

    class TooLargeException : IOException("Berkas terlalu besar")

    suspend fun fetch(client: OkHttpClient, url: String, file: File, maxBytes: Long, onProgress: (Float) -> Unit = {}) {
        var offset = 0L
        var total = -1L
        RandomAccessFile(file, "rw").use { raf ->
            raf.setLength(0)
            while (total < 0 || offset < total) {
                if (!currentCoroutineContext().isActive) throw IOException("Dibatalkan")
                val end = if (total > 0) minOf(offset + CHUNK, total) - 1 else offset + CHUNK - 1
                val req = Request.Builder().url(url).header("Range", "bytes=$offset-$end").build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
                    if (total < 0) {
                        total = resp.header("Content-Range")?.substringAfter('/')?.toLongOrNull()
                            ?: resp.body?.contentLength()?.takeIf { it > 0 && resp.code == 200 }
                            ?: throw IOException("Ukuran audio tidak diketahui")
                        if (total > maxBytes) throw TooLargeException()
                    }
                    val body = resp.body ?: throw IOException("Balasan kosong")
                    body.byteStream().use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            raf.write(buf, 0, n)
                            offset += n
                        }
                    }
                    if (resp.code == 200) offset = total
                    onProgress((offset.toFloat() / total).coerceIn(0f, 1f))
                }
            }
        }
    }
}
