package com.freease.music

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import com.freease.music.data.LibraryRepository
import com.freease.music.data.db.FreeaseDatabase
import com.freease.music.data.download.DownloadManager
import com.freease.music.data.db.DownloadState
import com.freease.music.data.lyrics.LyricsRepository
import com.freease.music.data.lyrics.align.LyricsAutoSync
import com.freease.music.data.prefs.SettingsRepository
import com.freease.music.data.youtube.NewPipeHttp
import com.freease.music.data.youtube.StreamHeadersInterceptor
import com.freease.music.data.youtube.YouTubeRepository
import com.freease.music.playback.AudioEffectsController
import com.freease.music.playback.PlayerConnection
import com.freease.music.playback.QueueStore
import com.freease.music.playback.SleepTimer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/** Dependency container sederhana (tanpa framework DI). */
@UnstableApi
class AppContainer(private val context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settings = SettingsRepository(context, appScope)

    val dataUsage = com.freease.music.data.DataUsage(context, appScope)

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        // Interceptor jaringan: menghitung byte yang benar-benar lewat (masih terkompresi), bukan hasil ekstraknya.
        .addNetworkInterceptor(dataUsage.interceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .connectionPool(ConnectionPool(8, 5, TimeUnit.MINUTES))
        .retryOnConnectionFailure(true)
        .build()

    /** Klien khusus stream (UA disesuaikan per client YouTube, timeout baca lebih longgar). */
    val streamClient: OkHttpClient = httpClient.newBuilder()
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(StreamHeadersInterceptor())
        .build()

    val db: FreeaseDatabase = FreeaseDatabase.build(context)
    val youtube = YouTubeRepository()
    val library = LibraryRepository(db)
    val lyrics = LyricsRepository(
        httpClient,
        File(context.filesDir, "lyrics3"),
        region = { settings.current.region },
        autoSync = LyricsAutoSync(youtube, streamClient, File(context.cacheDir, "align")) { id ->
            db.songs().get(id)?.takeIf { it.downloadState == DownloadState.DONE }?.downloadPath?.let(::File)
        },
        autoSyncEnabled = { settings.current.autoSyncLyrics && (!settings.current.saverOnCellular || !isMetered()) },
    )
    val downloads = DownloadManager(context, appScope)
    val loudness = com.freease.music.playback.loudness.LoudnessStore(File(context.filesDir, "loudness.json"))
    val importer = com.freease.music.data.importer.ImportManager(httpClient, youtube, library, appScope)
    val localMusic = com.freease.music.data.local.LocalMusicRepository(context)
    val queueStore = QueueStore(context)
    val alarms = com.freease.music.data.alarm.AlarmStore(context)
    val dailyMix = com.freease.music.data.mix.DailyMixRepository(File(context.filesDir, "daily_mix.json"), library, youtube)

    /** Data belajar Freease Pintar (database terpisah, dibuka hanya saat pertama dipakai). */
    private val tasteDb by lazy { com.freease.music.data.taste.TasteDatabase.build(context) }
    val smart: com.freease.music.playback.smart.SmartEngine by lazy {
        com.freease.music.playback.smart.SmartEngine(library, youtube, tasteDb.dao(), appScope)
    }
    val sleepTimer = SleepTimer()
    val effects = AudioEffectsController(context)
    val eqProfiles = com.freease.music.playback.EqProfiles(context, settings, appScope) { emitMessage("Equalizer: profil ${it.label}") }
    val player = PlayerConnection(context, CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate), youtube)

    /** true = tampilkan video (HD) di player; false = audio saja (hemat data & baterai). */
    val videoMode = MutableStateFlow(false)

    /** true selama layar Freease terlihat (untuk menyembunyikan lirik melayang). */
    val appVisible = MutableStateFlow(false)

    /** Permintaan membuka Freease Smart dari luar UI (mis. tekan lama tombol earphone). */
    val assistantRequests = kotlinx.coroutines.flow.MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Video sedang tampil di layar (pemutar/layar penuh) — tombol Home masuk ke Picture-in-Picture. */
    val videoOnScreen = MutableStateFlow(false)

    /** Aplikasi sedang dalam mode Picture-in-Picture (hanya video yang digambar). */
    val pipMode = MutableStateFlow(false)

    /** "Oke Freease": pendengar kata panggil. */
    val wake by lazy { com.freease.music.assistant.WakeController(context, settings, httpClient, appScope) }
    val voicePack by lazy { com.freease.music.assistant.VoicePack(context) }
    val assistantMemory = com.freease.music.assistant.AssistantMemory()
    val asr by lazy { com.freease.music.assistant.OfflineAsr(context, httpClient, appScope) }

    /** Asisten Freease sedang mendengarkan/berbicara → musik dikecilkan (diterapkan oleh PlaybackService). */
    val assistantDuck = MutableStateFlow(false)

    /** Info teknis audio yang sedang diputar (diisi PlaybackService). */
    val audioInfo = MutableStateFlow<com.freease.music.playback.AudioInfo?>(null)
    /** Penguatan normalisasi saat ini (dB), dibaca langsung dari jalur audio. */
    @Volatile var audioGainDb: () -> Double = { 0.0 }

    /** Pencarian yang diminta layar lain (mis. hasil Kenali Lagu) untuk dijalankan tab Cari. */
    val pendingSearch = MutableStateFlow<String?>(null)
    val canvas by lazy { com.freease.music.playback.CanvasResolver(context, youtube) }
    val translator by lazy { com.freease.music.data.lyrics.LyricsTranslator(httpClient, File(context.filesDir, "translations")) }
    val songParams by lazy { com.freease.music.playback.SongParams(context) }

    /** Mode Karaoke: vokal dihilangkan dari audio (tidak diingat setelah app ditutup). */
    val karaokeMode = MutableStateFlow(false)
    val karaoke by lazy {
        com.freease.music.karaoke.KaraokeEngine(context, youtube, streamClient, { id ->
            db.songs().get(id)?.takeIf { it.downloadState == com.freease.music.data.db.DownloadState.DONE }?.downloadPath
                ?.takeIf { java.io.File(it).exists() }
        }, appScope)
    }
    /** Sesi nyanyi karaoke (skor & rekam). */
    val singer by lazy { com.freease.music.karaoke.KaraokeSinger(context) }
    val recognizer by lazy { com.freease.music.data.recognize.SongRecognizer(httpClient) }
    val recognizeHistory by lazy { com.freease.music.data.recognize.RecognizeHistory(context) }

    val mediaCache: SimpleCache by lazy {
        val mb = settings.current.cacheSizeMb
        val evictor = if (mb <= 0) NoOpCacheEvictor() else LeastRecentlyUsedCacheEvictor(mb * 1024L * 1024L)
        SimpleCache(File(context.cacheDir, "media"), evictor, StandaloneDatabaseProvider(context))
    }

    /** Waktu terakhir pengguna menyentuh app atau mengendalikan pemutar (untuk tidur otomatis). */
    @Volatile var lastInteraction: Long = System.currentTimeMillis()
        private set

    fun touchInteraction() {
        lastInteraction = System.currentTimeMillis()
    }

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    fun emitMessage(text: String) {
        _messages.tryEmit(text)
    }

    init {
        YouTubeRepository.initNewPipe(NewPipeHttp(httpClient), settings.current.region)
        eqProfiles.start()
        // Jadwal unduhan otomatis mengikuti pengaturan (aktif hanya saat mengisi daya + Wi-Fi).
        appScope.launch {
            settings.flow.map { it.autoDownload }.distinctUntilChanged().collect {
                // WorkManager belum siap (mis. lingkungan uji) tidak boleh menjatuhkan aplikasi.
                runCatching { com.freease.music.data.download.AutoDownloader.sync(context, it) }
            }
        }
        appScope.launch {
            settings.flow.map { it.autoBackupFolder.isNotBlank() }.distinctUntilChanged().collect {
                com.freease.music.data.backup.AutoBackup.schedule(context, it)
            }
        }
    }

    /** Antrean untuk perintah suara: hasil pencarian (atau koleksi sendiri saat offline / kata kosong). */
    suspend fun voiceQueue(query: String): List<com.freease.music.data.model.Song> {
        val q = query.trim()
        if (q.isEmpty()) return library.likedSongs().shuffled().take(100)
        val online = if (isOnline()) runCatching { youtube.searchSongs(q, 15) }.getOrDefault(emptyList()) else emptyList()
        return online.ifEmpty { runCatching { library.searchLocal(q) }.getOrDefault(emptyList()) }
    }

    /** Simpan lirik semua lagu yang sudah diunduh (untuk unduhan lama sebelum fitur ini ada). @return jumlah lagu berlirik. */
    suspend fun saveLyricsForDownloads(onProgress: (Int, Int) -> Unit = { _, _ -> }): Int {
        val songs = db.songs().downloadsNow().filter { it.downloadState == DownloadState.DONE }.map { it.toSong() }
        var found = 0
        songs.forEachIndexed { i, s ->
            if (runCatching { !lyrics.get(s).isEmpty }.getOrDefault(false)) found++
            onProgress(i + 1, songs.size)
        }
        return found
    }

    /** Baterai < 15% dan tidak sedang dicas, dengan "Hemat baterai otomatis" aktif. */
    fun batteryLow(): Boolean {
        if (!settings.current.batterySaver) return false
        val bm = context.getSystemService(android.os.BatteryManager::class.java) ?: return false
        val level = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return level in 0..14 && !bm.isCharging
    }

    fun isMetered(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.isActiveNetworkMetered
    }

    fun isOnline(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
