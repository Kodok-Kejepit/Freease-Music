package com.freease.music.playback

/** Ringkasan teknis lagu yang sedang diputar ("Info audio"). */
data class AudioInfo(
    val songId: String,
    val source: String,
    val codec: String?,
    val sampleRate: Int,
    val channels: Int,
    val bitrateKbps: Int,
    val loudnessLufs: Double?,
    val targetLufs: Double?,
) {
    companion object {
        /** "audio/opus" → "Opus", "audio/mp4a-latm" → "AAC", dst. */
        fun codecName(mime: String?, codecs: String?): String? {
            val m = mime?.lowercase() ?: return codecs
            return when {
                "opus" in m -> "Opus"
                "mp4a" in m || "aac" in m -> "AAC"
                "mpeg" in m -> "MP3"
                "flac" in m -> "FLAC"
                "vorbis" in m -> "Vorbis"
                "raw" in m || "wav" in m -> "PCM (WAV)"
                "alac" in m -> "ALAC"
                else -> m.substringAfter('/').uppercase()
            }
        }
    }
}
