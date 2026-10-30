package com.freease.music.karaoke

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import com.freease.music.data.model.Song
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException

/** Satu lagu yang versi karaokenya tersimpan permanen. */
data class SavedKaraoke(val song: Song, val modelId: String, val file: File, val bytes: Long, val savedAt: Long)

/**
 * Hasil karaoke yang tersimpan permanen (tidak ikut terhapus seperti cache 6 lagu terakhir): WAV hasil AI
 * dikompres ke AAC (±1,2 MB per menit) bersama info lagunya, jadi bisa diputar lagi kapan saja tanpa
 * diproses ulang — juga saat offline.
 */
class KaraokeLibrary(private val dir: File) {
    private val _items = MutableStateFlow(scan())
    val items: StateFlow<List<SavedKaraoke>> = _items.asStateFlow()

    private fun key(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_").take(120)
    private fun audio(id: String) = File(dir, key(id) + ".m4a")
    private fun meta(id: String) = File(dir, key(id) + ".json")
    private fun vocal(id: String) = File(dir, key(id) + ".vox.m4a")

    /** Trek vokal tersimpan (untuk volume vokal & skor), atau null untuk simpanan versi lama. */
    fun vocalFile(id: String): File? = vocal(id).takeIf { it.length() > 0 }

    /** Berkas karaoke tersimpan untuk lagu [id], atau null. */
    fun file(id: String): File? = audio(id).takeIf { it.length() > 0 && meta(id).exists() }

    fun has(id: String) = file(id) != null

    /** Kompres [wav] (PCM 16-bit stereo) lalu simpan bersama info [song]. Dipanggil di thread latar. */
    fun save(song: Song, modelId: String, wav: File, sampleRate: Int, vocalWav: File? = null) {
        dir.mkdirs()
        val tmp = File(dir, key(song.id) + ".tmp")
        try {
            AacEncoder.encodeWav(wav, tmp, sampleRate, channels = 2)
            val target = audio(song.id)
            target.delete()
            if (!tmp.renameTo(target)) throw IOException("Gagal menyimpan karaoke")
            if (vocalWav != null) {
                // Vokal disimpan dengan bitrate lebih rendah: cukup untuk panduan nyanyi & skor.
                val vt = File(dir, key(song.id) + ".vox.tmp")
                runCatching {
                    AacEncoder.encodeWav(vocalWav, vt, sampleRate, channels = 2, bitrate = 96_000)
                    vocal(song.id).delete()
                    vt.renameTo(vocal(song.id))
                }
                vt.delete()
            }
            meta(song.id).writeText(
                JSONObject()
                    .put("id", song.id).put("title", song.title).put("artist", song.artist)
                    .put("artistUrl", song.artistUrl ?: "").put("album", song.album ?: "")
                    .put("duration", song.durationSec).put("thumbnail", song.thumbnail ?: "")
                    .put("model", modelId).put("savedAt", System.currentTimeMillis())
                    .toString(),
            )
        } finally {
            tmp.delete()
        }
        refresh()
    }

    fun delete(id: String) {
        audio(id).delete()
        vocal(id).delete()
        meta(id).delete()
        refresh()
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
        refresh()
    }

    fun totalBytes(): Long = _items.value.sumOf { it.bytes }

    fun refresh() {
        _items.value = scan()
    }

    private fun scan(): List<SavedKaraoke> = dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty().mapNotNull { f ->
        runCatching {
            val o = JSONObject(f.readText())
            val id = o.getString("id")
            val a = audio(id).takeIf { it.length() > 0 } ?: return@runCatching null
            val v = vocal(id).length()
            SavedKaraoke(
                song = Song(
                    id = id,
                    title = o.optString("title"),
                    artist = o.optString("artist"),
                    artistUrl = o.optString("artistUrl").ifEmpty { null },
                    album = o.optString("album").ifEmpty { null },
                    durationSec = o.optLong("duration"),
                    thumbnail = o.optString("thumbnail").ifEmpty { null },
                ),
                modelId = o.optString("model"),
                file = a,
                bytes = a.length() + v,
                savedAt = o.optLong("savedAt"),
            )
        }.getOrNull()
    }.sortedByDescending { it.savedAt }
}

/** Encoder AAC-LC (MediaCodec + MediaMuxer) untuk WAV PCM 16-bit. */
object AacEncoder {
    fun encodeWav(wav: File, out: File, sampleRate: Int, channels: Int, bitrate: Int = 160_000) {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        var muxer: MediaMuxer? = null
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            val mux = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            muxer = mux
            var track = -1
            val frameBytes = 2 * channels
            val info = MediaCodec.BufferInfo()
            val chunk = ByteArray(16 * 1024 / frameBytes * frameBytes)
            var frames = 0L
            var inputDone = false
            BufferedInputStream(FileInputStream(wav), 256 * 1024).use { input ->
                var skip = KaraokeEngine.WAV_HEADER.toLong()
                while (skip > 0) skip -= input.skip(skip).takeIf { it > 0 } ?: break
                while (true) {
                    if (!inputDone) {
                        val ii = codec.dequeueInputBuffer(10_000)
                        if (ii >= 0) {
                            val ib = codec.getInputBuffer(ii)!!
                            ib.clear()
                            val want = minOf(chunk.size, ib.remaining() / frameBytes * frameBytes)
                            var got = 0
                            while (got < want) {
                                val n = input.read(chunk, got, want - got)
                                if (n < 0) break
                                got += n
                            }
                            got = got / frameBytes * frameBytes
                            val pts = frames * 1_000_000L / sampleRate
                            if (got == 0) {
                                codec.queueInputBuffer(ii, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                ib.put(chunk, 0, got)
                                codec.queueInputBuffer(ii, 0, got, pts, 0)
                                frames += got / frameBytes
                            }
                        }
                    }
                    val oi = codec.dequeueOutputBuffer(info, 10_000)
                    if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        track = mux.addTrack(codec.outputFormat)
                        mux.start()
                    } else if (oi >= 0) {
                        val ob = codec.getOutputBuffer(oi)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && track >= 0) {
                            ob.position(info.offset)
                            ob.limit(info.offset + info.size)
                            mux.writeSampleData(track, ob, info)
                        }
                        codec.releaseOutputBuffer(oi, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
            }
            if (track < 0) throw IOException("Encoder AAC tidak menghasilkan data")
        } finally {
            runCatching { codec.stop() }
            codec.release()
            muxer?.let { m -> runCatching { m.stop() }; m.release() }
        }
    }
}
