package com.freease.music.karaoke

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.dnsoverhttps.DnsOverHttps
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Berkas besar yang diunduh sekali: beberapa sumber identik, ukuran & SHA-256 pasti. */
data class DownloadSpec(val fileName: String, val sizeBytes: Long, val sha256: String, val urls: List<String>)

/**
 * Mengunduh model AI dengan beberapa jalan keluar: tiap sumber dicoba dengan DNS biasa lalu dengan
 * DNS-over-HTTPS (Cloudflare/Google, lewat alamat IP langsung) — untuk jaringan yang memblokir lewat DNS.
 * Unduhan yang terputus dilanjutkan dari byte terakhir, dan hasilnya selalu dicek SHA-256-nya.
 */
class ModelDownloader(base: OkHttpClient) {
    private val plain = base.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()

    private val doh: OkHttpClient = run {
        val bootstrap = plain.newBuilder().build()
        fun resolver(url: String, vararg ips: String) = DnsOverHttps.Builder()
            .client(bootstrap)
            .url(url.toHttpUrl())
            .bootstrapDnsHosts(ips.map { InetAddress.getByName(it) })
            .build()
        val cloudflare = resolver("https://cloudflare-dns.com/dns-query", "1.1.1.1", "1.0.0.1")
        val google = resolver("https://dns.google/dns-query", "8.8.8.8", "8.8.4.4")
        plain.newBuilder().dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                runCatching { cloudflare.lookup(hostname) }.getOrNull()?.takeIf { it.isNotEmpty() }
                    ?: runCatching { google.lookup(hostname) }.getOrNull()?.takeIf { it.isNotEmpty() }
                    ?: Dns.SYSTEM.lookup(hostname)
        }).build()
    }

    suspend fun download(model: MdxModel, target: File, onProgress: (Float) -> Unit) = download(model.spec, target, onProgress)

    /** Unduh [model] ke [target]; [onProgress] 0..1. Melempar [IOException] berisi pesan yang mudah dipahami. */
    suspend fun download(model: DownloadSpec, target: File, onProgress: (Float) -> Unit) {
        val part = File(target.path + ".part")
        val errors = ArrayList<String>()
        for (url in model.urls) {
            for ((label, client) in listOf("dns" to plain, "doh" to doh)) {
                currentCoroutineContext().ensureActive()
                try {
                    fetchResumable(client, url, part, model.sizeBytes, onProgress)
                    if (part.length() == model.sizeBytes) {
                        if (sha256(part) != model.sha256) {
                            part.delete()
                            errors += "${url.toHttpUrl().host}: berkas rusak"
                            continue
                        }
                        if (!part.renameTo(target)) throw IOException("Gagal menyimpan model")
                        return
                    }
                } catch (e: IOException) {
                    errors += "${url.toHttpUrl().host} ($label): ${if (e is UnknownHostException) "diblokir/tidak ditemukan" else e.message}"
                }
            }
        }
        throw IOException(
            "Server model tidak bisa dijangkau dari jaringanmu. Coba jaringan lain atau VPN, " +
                "atau unduh berkasnya lewat browser lalu pilih \"Impor file\".\n(${errors.lastOrNull() ?: "tidak diketahui"})",
        )
    }

    private suspend fun fetchResumable(client: OkHttpClient, url: String, part: File, size: Long, onProgress: (Float) -> Unit) {
        var have = part.length().let { if (it > size) { part.delete(); 0L } else it }
        if (have == size) return
        val req = Request.Builder().url(url).apply { if (have > 0) header("Range", "bytes=$have-") }.build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val append = resp.code == 206 && have > 0
            if (!append) have = 0
            val body = resp.body ?: throw IOException("Balasan kosong")
            FileOutputStream(part, append).use { os ->
                body.byteStream().use { input -> copy(input, os, have, size, onProgress) }
            }
        }
    }

    private suspend fun copy(input: InputStream, os: FileOutputStream, start: Long, size: Long, onProgress: (Float) -> Unit) {
        val buf = ByteArray(256 * 1024)
        var got = start
        var last = 0L
        while (true) {
            currentCoroutineContext().ensureActive()
            val n = input.read(buf)
            if (n < 0) break
            os.write(buf, 0, n)
            got += n
            if (got - last > 512 * 1024) {
                last = got
                onProgress((got.toFloat() / size).coerceIn(0f, 1f))
            }
        }
    }

    companion object {
        fun sha256(f: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            f.inputStream().use { input ->
                val buf = ByteArray(1 shl 16)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    md.update(buf, 0, n)
                }
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
