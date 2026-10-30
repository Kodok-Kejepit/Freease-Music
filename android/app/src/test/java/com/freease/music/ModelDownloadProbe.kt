package com.freease.music

import com.freease.music.karaoke.MdxModel
import com.freease.music.karaoke.ModelDownloader
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile

/** Unduhan model sungguhan (opsional, butuh internet): -Pkaraoke.download=DIR berisi model asli untuk dipotong. */
class ModelDownloadProbe {
    @Test
    fun resumesAndVerifies(): Unit = runBlocking {
        val dir = System.getProperty("karaoke.download")
        Assume.assumeTrue(dir != null)
        val m = MdxModel.FAST
        val tmp = File(System.getProperty("java.io.tmpdir"), "dlprobe").apply { mkdirs() }
        val target = File(tmp, m.fileName)
        target.delete()
        // Pura-pura unduhan sebelumnya terputus di 10 MB.
        File(dir, m.fileName).inputStream().use { input ->
            File(target.path + ".part").outputStream().use { os ->
                val buf = ByteArray(10 * 1024 * 1024); val n = input.read(buf); os.write(buf, 0, n)
            }
        }
        var maxP = 0f
        ModelDownloader(OkHttpClient()).download(m, target) { maxP = maxOf(maxP, it) }
        assertEquals(m.sizeBytes, target.length())
        assertEquals(m.sha256, ModelDownloader.sha256(target))
        println("lanjut-unduh OK, progres terakhir ${(maxP * 100).toInt()}%")

        // Berkas sudah ada tapi rusak (byte diubah) → harus ditolak lalu diunduh ulang bersih.
        target.renameTo(File(target.path + ".part"))
        RandomAccessFile(File(target.path + ".part"), "rw").use { it.seek(5_000_000); it.write(0x55) }
        ModelDownloader(OkHttpClient()).download(m, target) {}
        assertEquals(m.sha256, ModelDownloader.sha256(target))
        println("berkas rusak terdeteksi & diunduh ulang OK")
        target.delete()
    }

    @Test
    fun dnsOverHttpsResolves() {
        Assume.assumeTrue(System.getProperty("karaoke.download") != null)
        val doh = okhttp3.dnsoverhttps.DnsOverHttps.Builder().client(OkHttpClient())
            .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
            .bootstrapDnsHosts(listOf(java.net.InetAddress.getByName("1.1.1.1")))
            .build()
        val ips = doh.lookup("huggingface.co")
        println("DoH huggingface.co -> ${ips.joinToString()}")
        assertTrue(ips.isNotEmpty())
    }
}
