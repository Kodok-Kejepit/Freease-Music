package com.freease.music

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.freease.music.data.LibraryRepository
import com.freease.music.data.backup.Backup
import com.freease.music.data.db.FreeaseDatabase
import com.freease.music.data.model.Song
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Cadangan v2: riwayat dengar ikut pindah ke HP/instalasi baru, tanpa dobel saat dipulihkan ulang. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackupHistoryTest {
    private fun db() = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), FreeaseDatabase::class.java)
        .allowMainThreadQueries().build()

    @Test
    fun historySurvivesReinstall() = runBlocking {
        val oldDb = db()
        val old = LibraryRepository(oldDb)
        val a = Song("a", "Hati-Hati di Jalan", "Tulus", durationSec = 243)
        val b = Song("b", "Bertaut", "Nadin Amizah", durationSec = 321)
        repeat(3) { old.recordPlay(a, 200_000) }
        old.recordPlay(b, 300_000)
        old.setLiked(b, true)
        val json = Backup.toJson(old.exportBackup())

        val newDb = db()
        val fresh = LibraryRepository(newDb)
        val sum = fresh.importBackup(Backup.parse(json))
        assertEquals(4, sum.plays)
        assertEquals(1, sum.newLiked)
        assertEquals(listOf("a", "b"), fresh.mostPlayed(5).first().map { it.id })
        assertEquals(3, newDb.songs().get("a")!!.playCount)
        assertEquals(900_000L, newDb.history().allEvents().sumOf { it.playedMs })

        // Dipulihkan sekali lagi: tidak ada yang bertambah.
        val again = fresh.importBackup(Backup.parse(json))
        assertEquals(0, again.plays)
        assertEquals(4, newDb.history().allEvents().size)

        // Cadangan versi 1 (tanpa riwayat) tetap bisa dipulihkan.
        val v1 = """{"format":"freease-backup","version":1,"liked":[{"id":"c","title":"T","artist":"A"}],"playlists":[],"artists":[]}"""
        assertEquals(1, fresh.importBackup(Backup.parse(v1)).newLiked)
        oldDb.close(); newDb.close()
    }
}

class AutoBackupRotationTest {
    @Test
    fun keepsNewestFour() {
        val p = com.freease.music.data.backup.AutoBackup.PREFIX
        val names = listOf("20261001-0900", "20261008-0900", "20261015-0900", "20261022-0900", "20261029-0900", "20260924-0900").map { "$p$it.json" }
        assertEquals(listOf("${p}20261001-0900.json", "${p}20260924-0900.json"), com.freease.music.data.backup.AutoBackup.oldOnes(names))
        assertEquals(emptyList<String>(), com.freease.music.data.backup.AutoBackup.oldOnes(names.take(3)))
    }
}
