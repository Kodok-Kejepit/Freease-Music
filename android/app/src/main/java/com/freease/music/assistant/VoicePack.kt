package com.freease.music.assistant

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.io.IOException
import java.util.zip.ZipInputStream

/**
 * "Suara Dev (Kodok-Kejepit)": jawaban asisten memakai rekaman suara asli, bukan suara robot. Klip bawaan
 * ada di `assets/voice_dev/<jenis>.ogg`; klip yang direkam/diimpor di aplikasi menimpa klip bawaan.
 * Jawaban yang tidak punya klip khusus memakai klip "oke"; teks lengkapnya tetap tampil di layar.
 */
class VoicePack(private val context: Context) {
    enum class Clip(val label: String, val suggestion: String) {
        GREET("Saat dipanggil", "Hallo!"),
        ACK("Siap / oke", "Oke."),
        PLAY("Memutar lagu", "Gua yang puterin."),
        SEARCH("Mencari", "Nanti gua cariin."),
        DOWNLOADS("Memutar unduhan", "Gua puterin lagu yang udah lu download."),
        PAUSE("Menjeda", "Oke, gua jeda dulu."),
        NEXT("Lagu berikutnya", "Lanjut lagu berikutnya."),
        KARAOKE("Karaoke menyala", "Karaoke nyala, gas nyanyi!"),
        SLEEP("Timer tidur", "Siap, nanti musiknya gua matiin."),
        INTRO("Perkenalan / bantuan", "Gua adalah Freease, asisten pribadi lu yang dibikin sama Kodok-Kejepit."),
        NOT_UNDERSTOOD("Belum paham", "Sorry bro, gua belum ngerti."),
        NOT_FOUND("Tidak ketemu", "Sorry, lagunya nggak ketemu."),
        FUN("Seru", "Gila ga tuh?"),
        THANKS("Terima kasih", "Thank you."),
    }

    private val dir = File(context.filesDir, "voice_pack")
    private val _clips = MutableStateFlow(scan())
    val clips: StateFlow<Set<Clip>> = _clips.asStateFlow()
    private var player: MediaPlayer? = null
    private var recorder: MediaRecorder? = null

    private fun fileFor(c: Clip): File? = dir.listFiles()?.firstOrNull { it.nameWithoutExtension == c.name.lowercase() && it.length() > 0 }

    private fun scan(): Set<Clip> = Clip.entries.filter { fileFor(it) != null }.toSet()

    private val assetNames: Map<Clip, String> = runCatching {
        context.assets.list(ASSET_DIR).orEmpty().mapNotNull { n ->
            Clip.entries.firstOrNull { it.name.lowercase() == n.substringBeforeLast('.').lowercase() }?.let { it to n }
        }.toMap()
    }.getOrDefault(emptyMap())

    /** Klip bawaan aplikasi (suara Dev). */
    val builtIn: Set<Clip> = assetNames.keys

    fun has(c: Clip) = c in _clips.value

    val isEmpty: Boolean get() = _clips.value.isEmpty()

    /** Putar klip [c] (atau klip "oke" bila [c] tidak ada). @return false kalau tidak ada klip sama sekali. */
    fun play(c: Clip, onDone: () -> Unit = {}): Boolean {
        val file = fileFor(c)
        val asset = if (file == null) assetNames[c] else null
        val ack = if (file == null && asset == null) fileFor(Clip.ACK) else null
        val ackAsset = if (file == null && asset == null && ack == null) assetNames[Clip.ACK] else null
        if (file == null && asset == null && ack == null && ackAsset == null) return false
        stop()
        val p = MediaPlayer()
        player = p
        return runCatching {
            p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            val f = file ?: ack
            if (f != null) {
                p.setDataSource(f.path)
            } else {
                context.assets.openFd("$ASSET_DIR/${asset ?: ackAsset}").use { p.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            }
            p.setVolume(0.85f, 0.85f)
            p.setOnCompletionListener { stop(); onDone() }
            p.prepare()
            p.start()
            true
        }.getOrElse { stop(); false }
    }

    fun stop() {
        player?.run { runCatching { stop() }; release() }
        player = null
    }

    /** Mulai merekam klip [c] (maks. 6 detik). */
    fun startRecording(c: Clip) {
        stopRecording(save = false)
        dir.mkdirs()
        val tmp = File(dir, "rec.tmp")
        @Suppress("DEPRECATION")
        val r = if (android.os.Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioSamplingRate(44_100)
        r.setAudioEncodingBitRate(96_000)
        r.setMaxDuration(6_000)
        r.setOutputFile(tmp.path)
        r.prepare()
        r.start()
        recorder = r
        recording = c
    }

    private var recording: Clip? = null

    /** Amplitudo puncak sejak panggilan terakhir (0..32767) selama merekam; untuk deteksi selesai bicara. */
    fun amplitude(): Int = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)

    fun stopRecording(save: Boolean = true) {
        val r = recorder ?: return
        val c = recording
        recorder = null
        recording = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val tmp = File(dir, "rec.tmp")
        if (save && ok && c != null && tmp.length() > 0) {
            fileFor(c)?.delete()
            tmp.renameTo(File(dir, c.name.lowercase() + ".m4a"))
        } else {
            tmp.delete()
        }
        _clips.value = scan()
    }

    fun delete(c: Clip) {
        fileFor(c)?.delete()
        _clips.value = scan()
    }

    fun clear() {
        dir.deleteRecursively()
        _clips.value = scan()
    }

    /**
     * Impor paket suara (.zip) berisi berkas bernama sesuai jenis klip, mis. `play.ogg`, `ack.m4a`.
     * @return jumlah klip yang dipasang.
     */
    fun importZip(source: Uri): Int {
        dir.mkdirs()
        var count = 0
        val input = context.contentResolver.openInputStream(source) ?: throw IOException("Berkas tidak bisa dibaca")
        ZipInputStream(input.buffered()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name.substringAfterLast('/').lowercase()
                val base = name.substringBeforeLast('.')
                val ext = name.substringAfterLast('.', "")
                val clip = Clip.entries.firstOrNull { it.name.lowercase() == base } ?: continue
                if (ext !in setOf("ogg", "opus", "m4a", "mp3", "wav", "aac")) continue
                fileFor(clip)?.delete()
                val out = File(dir, "${clip.name.lowercase()}.$ext")
                var written = 0L
                out.outputStream().use { os ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = z.read(buf)
                        if (n < 0) break
                        written += n
                        if (written > MAX_CLIP_BYTES) {
                            os.close()
                            out.delete()
                            _clips.value = scan()
                            throw IOException("Klip ${clip.label} terlalu besar (maks. 2 MB)")
                        }
                        os.write(buf, 0, n)
                    }
                }
                count++
            }
        }
        _clips.value = scan()
        if (count == 0) throw IOException("Tidak ada klip yang dikenali di paket ini")
        return count
    }

    private companion object {
        const val MAX_CLIP_BYTES = 2L * 1024 * 1024
        const val ASSET_DIR = "voice_dev"
    }
}
