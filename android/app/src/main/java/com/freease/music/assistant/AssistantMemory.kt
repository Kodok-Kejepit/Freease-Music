package com.freease.music.assistant

import com.freease.music.data.model.Song

/**
 * Ingatan singkat asisten antar-perintah (selama aplikasi hidup), supaya "yang lain dong" atau
 * "yang tadi lagi" nyambung dengan permintaan sebelumnya walau jendela asisten sudah ditutup.
 */
class AssistantMemory {
    /** Pencarian terakhir yang diputar ("putar Tulus" → "tulus"). */
    @Volatile var lastQuery: String? = null
    @Volatile var lastMood: MoodKind? = null
    /** Lagu yang sedang diputar sebelum asisten memutar sesuatu yang baru. */
    @Volatile var previousSong: Song? = null
    private val played = LinkedHashSet<String>()
    @Volatile private var updatedAt = 0L

    /** Konteks dianggap basi setelah 30 menit. */
    val fresh: Boolean get() = System.currentTimeMillis() - updatedAt < 30 * 60_000L

    @Synchronized
    fun remember(query: String?, mood: MoodKind?, songs: List<Song>, before: Song?) {
        lastQuery = query
        lastMood = mood
        if (before != null && songs.none { it.id == before.id }) previousSong = before
        songs.forEach { played += it.id }
        while (played.size > 300) played.remove(played.first())
        updatedAt = System.currentTimeMillis()
    }

    @Synchronized
    fun alreadyPlayed(id: String) = id in played
}
