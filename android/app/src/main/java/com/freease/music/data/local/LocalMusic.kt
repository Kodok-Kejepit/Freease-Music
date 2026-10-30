package com.freease.music.data.local

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.request.Options
import com.freease.music.data.model.Song
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Lagu dari penyimpanan HP. Id-nya "local:<id MediaStore>" supaya tidak tertukar dengan video YouTube. */
object LocalSongs {
    const val PREFIX = "local:"
    /** Berkas yang dibuka dari aplikasi lain (file manager, WhatsApp, …): "ext:<uri>". */
    const val EXT_PREFIX = "ext:"
    const val ART_SCHEME = "localart"

    fun isLocal(id: String) = id.startsWith(PREFIX) || id.startsWith(EXT_PREFIX)

    fun isExternal(id: String) = id.startsWith(EXT_PREFIX)

    fun external(uri: Uri) = EXT_PREFIX + uri.toString()

    private fun mediaId(id: String) = id.removePrefix(PREFIX).toLongOrNull() ?: -1

    fun contentUri(id: String): Uri =
        if (isExternal(id)) Uri.parse(id.removePrefix(EXT_PREFIX))
        else ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId(id))

    /** Alamat sampul untuk Coil (dimuat oleh [LocalArtFetcher]). */
    fun artUri(id: String) = "$ART_SCHEME://${mediaId(id)}"
}

class LocalMusicRepository(private val context: Context) {
    /** Semua lagu (≥ 30 detik) di HP, terbaru dulu. */
    suspend fun songs(): List<Song> = withContext(Dispatchers.IO) {
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
        )
        val out = ArrayList<Song>()
        context.contentResolver.query(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection,
            "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= 30000",
            null,
            "${MediaStore.Audio.Media.DATE_ADDED} DESC",
        )?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val iTitle = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val iArtist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val iAlbum = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val iDur = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            while (c.moveToNext()) {
                val id = LocalSongs.PREFIX + c.getLong(iId)
                val artist = c.getString(iArtist)?.takeIf { it.isNotBlank() && it != MediaStore.UNKNOWN_STRING } ?: "Artis tidak diketahui"
                out += Song(
                    id = id,
                    title = c.getString(iTitle)?.takeIf { it.isNotBlank() } ?: "Tanpa judul",
                    artist = artist,
                    album = c.getString(iAlbum)?.takeIf { it.isNotBlank() && it != MediaStore.UNKNOWN_STRING },
                    durationSec = c.getLong(iDur) / 1000,
                    thumbnail = LocalSongs.artUri(id),
                )
            }
        }
        out
    }
}

/** Video yang tersimpan di HP (≥ 5 detik), terbaru dulu; diputar sebagai berkas "ext:". */
suspend fun LocalMusicRepository.videos(context: Context): List<Song> = withContext(Dispatchers.IO) {
    val projection = arrayOf(
        MediaStore.Video.Media._ID,
        MediaStore.Video.Media.DISPLAY_NAME,
        MediaStore.Video.Media.TITLE,
        MediaStore.Video.Media.ARTIST,
        MediaStore.Video.Media.DURATION,
    )
    val out = ArrayList<Song>()
    context.contentResolver.query(
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
        projection,
        "${MediaStore.Video.Media.DURATION} >= 5000",
        null,
        "${MediaStore.Video.Media.DATE_ADDED} DESC",
    )?.use { c ->
        val iId = c.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
        val iName = c.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
        val iTitle = c.getColumnIndexOrThrow(MediaStore.Video.Media.TITLE)
        val iArtist = c.getColumnIndexOrThrow(MediaStore.Video.Media.ARTIST)
        val iDur = c.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
        while (c.moveToNext()) {
            val uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, c.getLong(iId))
            out += Song(
                id = LocalSongs.external(uri),
                title = c.getString(iTitle)?.takeIf { it.isNotBlank() } ?: c.getString(iName)?.substringBeforeLast('.') ?: "Video",
                artist = c.getString(iArtist)?.takeIf { it.isNotBlank() && it != MediaStore.UNKNOWN_STRING } ?: "Video di HP",
                durationSec = c.getLong(iDur) / 1000,
            )
        }
    }
    out
}

/** Memuat sampul album dari berkas lagu di HP untuk Coil ("localart://<id>"). */
class LocalArtFetcher(
    private val context: Context,
    private val mediaId: Long,
    private val options: Options,
    private val external: Uri? = null,
) : Fetcher {
    override suspend fun fetch(): FetchResult? = withContext(Dispatchers.IO) {
        val uri = external ?: ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId)
        val bmp: Bitmap? = runCatching {
            if (external != null) {
                // Berkas dari aplikasi lain: sampul tertanam, atau satu frame untuk video.
                val retriever = android.media.MediaMetadataRetriever()
                try {
                    retriever.setDataSource(context, uri)
                    retriever.embeddedPicture?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
                        ?: retriever.getFrameAtTime(2_000_000)
                } finally {
                    retriever.release()
                }
            } else if (Build.VERSION.SDK_INT >= 29) {
                context.contentResolver.loadThumbnail(uri, Size(512, 512), null)
            } else {
                val retriever = android.media.MediaMetadataRetriever()
                try {
                    retriever.setDataSource(context, uri)
                    retriever.embeddedPicture?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
                } finally {
                    retriever.release()
                }
            }
        }.getOrNull()
        bmp?.let { ImageFetchResult(it.asImage(), isSampled = true, dataSource = DataSource.DISK) }
    }

    class Factory(private val context: Context) : Fetcher.Factory<coil3.Uri> {
        override fun create(data: coil3.Uri, options: Options, imageLoader: ImageLoader): Fetcher? {
            if (data.scheme != LocalSongs.ART_SCHEME) return null
            if (data.authority == "ext") {
                val raw = data.path?.removePrefix("/") ?: return null
                return LocalArtFetcher(context, -1, options, Uri.parse(Uri.decode(raw)))
            }
            val id = data.authority?.toLongOrNull() ?: return null
            return LocalArtFetcher(context, id, options)
        }
    }
}

/** Berkas audio/video yang dibuka dari aplikasi lain (file manager, chat, unduhan browser). */
object ExternalMedia {
    /** Tipe yang bisa diputar: semua audio & video, plus ogg yang sering ditandai "application/ogg". */
    fun isPlayableType(mime: String?): Boolean =
        mime != null && (mime.startsWith("audio/") || mime.startsWith("video/") || mime == "application/ogg" || mime == "application/x-ogg")

    /** Simpan izin baca bila diberikan secara permanen (dokumen SAF); izin sementara tetap cukup untuk sesi ini. */
    fun keepAccess(context: Context, uri: Uri) {
        runCatching { context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
    }

    /** Baca judul, artis, dan durasi dari tag berkas; kalau tidak ada, pakai nama berkasnya. */
    suspend fun describe(context: Context, uri: Uri): Song = withContext(Dispatchers.IO) {
        val name = runCatching {
            context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/')
        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var durationMs = 0L
        val r = android.media.MediaMetadataRetriever()
        try {
            r.setDataSource(context, uri)
            title = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_TITLE)
            artist = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ARTIST)
                ?: r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
            album = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ALBUM)
            durationMs = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        } catch (_: Exception) {
            // Tag tidak terbaca — tetap bisa diputar.
        } finally {
            runCatching { r.release() }
        }
        Song(
            id = LocalSongs.external(uri),
            title = title?.takeIf { it.isNotBlank() } ?: name?.substringBeforeLast('.')?.takeIf { it.isNotBlank() } ?: "Berkas media",
            artist = artist?.takeIf { it.isNotBlank() } ?: "Berkas di HP",
            album = album?.takeIf { it.isNotBlank() },
            durationSec = durationMs / 1000,
        )
    }
}
