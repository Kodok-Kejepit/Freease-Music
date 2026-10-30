package com.freease.music

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.freease.music.data.db.FreeaseDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/** Database versi 1 (Freease ≤ 1.8) dibuka oleh versi 2.0: data tetap ada, kolom folder kosong. */
@RunWith(RobolectricTestRunner::class)
class MigrationTest {
    @Test
    fun v1ToV2KeepsPlaylists() = runBlocking<Unit> {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val name = "migrate-test.db"
        ctx.deleteDatabase(name)
        val schema = JSONObject(File("schemas/com.freease.music.data.db.FreeaseDatabase/1.json").readText()).getJSONObject("database")
        SQLiteDatabase.openOrCreateDatabase(ctx.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { db ->
            val entities = schema.getJSONArray("entities")
            for (i in 0 until entities.length()) {
                val e = entities.getJSONObject(i)
                db.execSQL(e.getString("createSql").replace("\${TABLE_NAME}", e.getString("tableName")))
                val idx = e.optJSONArray("indices") ?: continue
                for (j in 0 until idx.length()) db.execSQL(idx.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}", e.getString("tableName")))
            }
            val setup = schema.getJSONArray("setupQueries")
            for (i in 0 until setup.length()) db.execSQL(setup.getString(i))
            db.execSQL("INSERT INTO playlists (name, description, createdAt, updatedAt, remoteUrl, pinned) VALUES ('Santai', '', 1, 1, NULL, 0)")
            db.version = 1
        }
        val room = Room.databaseBuilder(ctx, FreeaseDatabase::class.java, name)
            .addMigrations(FreeaseDatabase.MIGRATION_1_2)
            .allowMainThreadQueries()
            .build()
        try {
            val lists = room.playlists().summaries().first()
            assertEquals(listOf("Santai"), lists.map { it.name })
            assertEquals("", lists.single().folder)
            room.playlists().setFolder(lists.single().id, "Galau")
            assertEquals("Galau", room.playlists().summaries().first().single().folder)
        } finally {
            room.close()
        }
    }
}
