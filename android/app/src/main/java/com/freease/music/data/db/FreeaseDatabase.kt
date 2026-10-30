package com.freease.music.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        SongEntity::class, PlaylistEntity::class, PlaylistSongEntity::class,
        PlayEventEntity::class, SearchQueryEntity::class, ArtistEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class FreeaseDatabase : RoomDatabase() {
    abstract fun songs(): SongDao
    abstract fun playlists(): PlaylistDao
    abstract fun history(): HistoryDao
    abstract fun search(): SearchDao
    abstract fun artists(): ArtistDao

    companion object {
        /** 2.0: folder playlist. */
        val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE playlists ADD COLUMN folder TEXT NOT NULL DEFAULT ''")
            }
        }

        fun build(context: Context): FreeaseDatabase =
            Room.databaseBuilder(context, FreeaseDatabase::class.java, "freease.db")
                .addMigrations(MIGRATION_1_2)
                .fallbackToDestructiveMigrationOnDowngrade(true)
                .build()
    }
}
