package com.freease.music.karaoke

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Hasil dekode: PCM 16-bit stereo mentah di [file]. */
class DecodedPcm(val file: File, val sampleRate: Int, val frames: Long)

/**
 * Mendekode lagu (webm/opus, m4a/aac, mp3, flac, …) dengan decoder bawaan HP menjadi PCM 16-bit
 * stereo mentah. Mono digandakan, lebih dari 2 kanal diambil 2 kanal pertama.
 */
object PcmDecoder {
    private const val TIMEOUT_US = 10_000L

    fun decode(context: Context, source: Uri, out: File, isActive: () -> Boolean, onProgress: (Float) -> Unit): DecodedPcm {
        val ex = MediaExtractor()
        try {
            if (source.scheme == "content") ex.setDataSource(context, source, null) else ex.setDataSource(source.path!!)
            val track = (0 until ex.trackCount).firstOrNull {
                ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IOException("Tidak ada trek audio")
            ex.selectTrack(track)
            val format = ex.getTrackFormat(track)
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            try {
                codec.configure(format, null, null, 0)
                codec.start()
                return run(ex, codec, format, out, durationUs, isActive, onProgress)
            } finally {
                runCatching { codec.stop() }
                codec.release()
            }
        } finally {
            ex.release()
        }
    }

    private fun run(
        ex: MediaExtractor, codec: MediaCodec, input: MediaFormat, file: File, durationUs: Long,
        isActive: () -> Boolean, onProgress: (Float) -> Unit,
    ): DecodedPcm {
        var rate = input.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = input.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var floatPcm = false
        var frames = 0L
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        val bytes = ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN)
        BufferedOutputStream(FileOutputStream(file), 256 * 1024).use { os ->
            fun put(l: Short, r: Short) {
                if (bytes.remaining() < 4) {
                    os.write(bytes.array(), 0, bytes.position())
                    bytes.clear()
                }
                bytes.putShort(l).putShort(r)
                frames++
            }
            while (true) {
                if (!isActive()) throw IOException("Dibatalkan")
                if (!inputDone) {
                    val ii = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (ii >= 0) {
                        val buf = codec.getInputBuffer(ii)!!
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(ii, 0, n, ex.sampleTime, 0)
                            if (durationUs > 0) onProgress((ex.sampleTime.toFloat() / durationUs).coerceIn(0f, 1f))
                            ex.advance()
                        }
                    }
                }
                val oi = codec.dequeueOutputBuffer(info, TIMEOUT_US)
                when {
                    oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = codec.outputFormat
                        rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    }
                    oi >= 0 -> {
                        if (info.size > 0) {
                            val o = codec.getOutputBuffer(oi)!!
                            o.position(info.offset)
                            o.limit(info.offset + info.size)
                            val b = o.slice().order(ByteOrder.nativeOrder())
                            if (floatPcm) {
                                val fb = b.asFloatBuffer()
                                while (fb.remaining() >= channels) {
                                    val l = fb.get()
                                    val r = if (channels > 1) fb.get() else l
                                    repeat(channels - 2) { fb.get() }
                                    put(toShort(l), toShort(r))
                                }
                            } else {
                                val sb = b.asShortBuffer()
                                while (sb.remaining() >= channels) {
                                    val l = sb.get()
                                    val r = if (channels > 1) sb.get() else l
                                    repeat(channels - 2) { sb.get() }
                                    put(l, r)
                                }
                            }
                        }
                        codec.releaseOutputBuffer(oi, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
            }
            os.write(bytes.array(), 0, bytes.position())
        }
        if (frames == 0L) throw IOException("Audio kosong")
        return DecodedPcm(file, rate, frames)
    }

    private fun toShort(f: Float) = (f * 32767f).coerceIn(-32768f, 32767f).toInt().toShort()
}
