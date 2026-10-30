package com.freease.music.karaoke

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.io.InterruptedIOException
import java.io.RandomAccessFile

/**
 * Membaca WAV hasil karaoke yang mungkin masih ditulis: kalau bagian yang diminta belum jadi,
 * tunggu (ExoPlayer menampilkan "buffering") sampai mesin menuliskannya.
 */
@UnstableApi
class KaraokeDataSource(private val engine: KaraokeEngine) : BaseDataSource(false) {
    private var uri: Uri? = null
    private var out: KaraokeEngine.Output? = null
    private var raf: RandomAccessFile? = null
    /** Trek vokal untuk dicampur kembali (volume vokal > 0). */
    private var vox: RandomAccessFile? = null
    private var voxBuf = ByteArray(0)
    private var position = 0L
    private var remaining = 0L

    override fun open(dataSpec: DataSpec): Long {
        val u = dataSpec.uri
        uri = u
        val model = MdxModel.byId(u.host)
        val id = Uri.decode(u.lastPathSegment ?: throw IOException("URI karaoke tidak valid"))
        val o = engine.output(model, id) ?: throw IOException("Karaoke belum disiapkan")
        out = o
        transferInitializing(dataSpec)
        raf = RandomAccessFile(o.file, "r")
        vox = engine.vocalFile(model, id).takeIf { it.exists() }?.let { runCatching { RandomAccessFile(it, "r") }.getOrNull() }
        position = dataSpec.position
        remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else o.totalBytes - position
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining <= 0) return C.RESULT_END_OF_INPUT
        val o = out ?: throw IOException("Belum dibuka")
        // Tunggu sampai data di posisi ini sudah ditulis.
        synchronized(o.lock) {
            while (o.written <= position && !o.done) {
                o.error?.let { throw IOException(it) }
                try {
                    o.lock.wait(200)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw InterruptedIOException()
                }
            }
        }
        o.error?.let { throw IOException(it) }
        val available = (minOf(o.written, o.totalBytes) - position).coerceAtLeast(0)
        if (available == 0L) return C.RESULT_END_OF_INPUT
        var n = minOf(length.toLong(), available, remaining).toInt()
        val gain = engine.vocalGain
        val v = vox
        // Campur per sampel 16-bit: jaga supaya potongan selalu genap.
        if (v != null && n > 1) n = n and 1.inv()
        val f = raf ?: throw IOException("Belum dibuka")
        f.seek(position)
        val r = f.read(buffer, offset, n)
        if (r <= 0) return C.RESULT_END_OF_INPUT
        if (gain > 0f && v != null && position >= KaraokeEngine.WAV_HEADER && r > 1) mixVocal(v, buffer, offset, r and 1.inv(), gain)
        position += r
        remaining -= r
        bytesTransferred(r)
        return r
    }

    private fun mixVocal(v: RandomAccessFile, buffer: ByteArray, offset: Int, n: Int, gain: Float) {
        if (voxBuf.size < n) voxBuf = ByteArray(n)
        val got = runCatching { v.seek(position); v.read(voxBuf, 0, n) }.getOrDefault(-1)
        if (got <= 1) return
        var i = 0
        while (i + 1 < got) {
            val a = (buffer[offset + i].toInt() and 0xFF) or (buffer[offset + i + 1].toInt() shl 8)
            val b = (voxBuf[i].toInt() and 0xFF) or (voxBuf[i + 1].toInt() shl 8)
            val m = (a + b * gain).toInt().coerceIn(-32768, 32767)
            buffer[offset + i] = m.toByte()
            buffer[offset + i + 1] = (m shr 8).toByte()
            i += 2
        }
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        runCatching { raf?.close() }
        raf = null
        runCatching { vox?.close() }
        vox = null
        if (out != null) {
            out = null
            transferEnded()
        }
    }

    class Factory(private val engine: KaraokeEngine) : DataSource.Factory {
        override fun createDataSource(): DataSource = KaraokeDataSource(engine)
    }
}
