package com.freease.music

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.test.core.app.ApplicationProvider
import com.freease.music.data.youtube.YouTubeRepository
import com.freease.music.karaoke.KaraokeDataSource
import com.freease.music.karaoke.KaraokeEngine
import com.freease.music.karaoke.MdxModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile

/** Pemutar membaca WAV karaoke yang masih ditulis: harus menunggu, bukan berhenti, dan hasilnya utuh. */
@UnstableApi
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class KaraokeDataSourceTest {
    @Test
    fun readsWhileWriting() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val engine = KaraokeEngine(ctx, YouTubeRepository(), OkHttpClient(), { null }, CoroutineScope(Dispatchers.Default))
        val frames = 48_000L * 3
        val total = KaraokeEngine.WAV_HEADER + frames * 4
        val file = File(ctx.cacheDir, "test_karaoke.wav")
        val expected = ByteArray(total.toInt()) { i -> if (i < KaraokeEngine.WAV_HEADER) KaraokeEngine.wavHeader(frames, 48_000)[i] else (i * 31).toByte() }
        val out = KaraokeEngine.Output(file, total, 48_000)
        engine.attach(MdxModel.FAST, "abc", out)
        RandomAccessFile(file, "rw").use { it.setLength(0) }

        // Penulis: 10 potongan dengan jeda, seperti model yang sedang bekerja.
        val writer = Thread {
            RandomAccessFile(file, "rw").use { raf ->
                val step = (total / 10).toInt()
                var pos = 0
                while (pos < total) {
                    val n = minOf(step, (total - pos).toInt())
                    raf.seek(pos.toLong()); raf.write(expected, pos, n)
                    pos += n
                    out.written = pos.toLong()
                    out.notifyAllWaiting()
                    Thread.sleep(30)
                }
                out.done = true
                out.notifyAllWaiting()
            }
        }
        writer.start()

        val ds = KaraokeDataSource(engine)
        val len = ds.open(DataSpec(Uri.parse(KaraokeEngine.uriFor(MdxModel.FAST, "abc"))))
        assertEquals(total, len)
        val got = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (true) {
            val n = ds.read(buf, 0, buf.size)
            if (n == C.RESULT_END_OF_INPUT) break
            got.write(buf, 0, n)
        }
        ds.close()
        writer.join()
        assertArrayEquals(expected, got.toByteArray())

        // Membuka dari tengah (seek) juga benar.
        val ds2 = KaraokeDataSource(engine)
        ds2.open(DataSpec.Builder().setUri(Uri.parse(KaraokeEngine.uriFor(MdxModel.FAST, "abc"))).setPosition(100_000).build())
        val b2 = ByteArray(16)
        assertEquals(16, ds2.read(b2, 0, 16))
        assertArrayEquals(expected.copyOfRange(100_000, 100_016), b2)
        ds2.close()
    }
}
