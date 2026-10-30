package com.freease.music.playback

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import com.freease.music.playback.loudness.NormalizingAudioProcessor
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.freease.music.FreeaseApp
import com.freease.music.MainActivity
import com.freease.music.R
import com.freease.music.data.alarm.AlarmScheduler
import com.freease.music.data.db.DownloadState
import com.freease.music.data.model.Song
import com.freease.music.data.prefs.AudioQuality
import com.freease.music.playback.smart.SmartMood
import com.freease.music.widget.PlayerWidget
import coil3.imageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@UnstableApi
class PlaybackService : MediaLibraryService() {
    private val container get() = (application as FreeaseApp).container
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var exo: ExoPlayer
    private lateinit var mixer: VolumeMixer
    private lateinit var lyricsDisplay: LyricsDisplay

    /** Normalisasi volume (ITU-R BS.1770) di jalur audio ExoPlayer. */
    private val normalizer = NormalizingAudioProcessor { id, lufs, sec ->
        // Cukup panjang untuk dipercaya: simpan supaya putaran berikutnya langsung pas.
        if (sec >= 30) {
            container.loudness.put(id, lufs)
            container.appScope.launch(Dispatchers.IO) { container.loudness.save() }
        }
    }
    private var session: MediaLibraryService.MediaLibrarySession? = null
    private val tree by lazy { LibraryTree(container) }

    private val likeCommand = SessionCommand(ACTION_LIKE, Bundle.EMPTY)
    private val retries = HashMap<String, Int>()

    // Pelacakan waktu dengar untuk riwayat & statistik.
    private var trackingSong: Song? = null

    // Lewati bagian non-musik (SponsorBlock "music_offtopic").
    private val nonMusic by lazy { NonMusicSkipper(container.httpClient) }
    private var nonMusicSegs: Pair<String, List<NonMusicSkipper.Segment>>? = null
    private val nonMusicDone = HashSet<String>()

    private fun loadNonMusic(item: MediaItem?) {
        nonMusicSegs = null
        val id = item?.mediaId ?: return
        if (!container.settings.current.skipNonMusic || MediaItems.isLive(item) || com.freease.music.data.local.LocalSongs.isLocal(id)) return
        scope.launch {
            val segs = nonMusic.segments(id)
            if (exo.currentMediaItem?.mediaId == id) {
                nonMusicSegs = id to segs
                checkNonMusic()
            }
        }
    }

    private fun checkNonMusic() {
        val (id, segs) = nonMusicSegs ?: return
        if (segs.isEmpty() || exo.currentMediaItem?.mediaId != id || !container.settings.current.skipNonMusic) return
        val dur = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        val seg = NonMusicSkipper.active(segs, exo.currentPosition, dur) ?: return
        // Tiap bagian dilewati sekali; kalau pengguna sengaja mundur ke situ, biarkan.
        if (!nonMusicDone.add("$id@${seg.startMs}")) return
        if (dur > 0 && seg.endMs >= dur - 1_500 && exo.hasNextMediaItem()) exo.seekToNextMediaItem() else exo.seekTo(seg.endMs)
        container.emitMessage("Bagian non-musik dilewati")
    }
    private var listenedMs = 0L
    private var lastTick = 0L
    private var fadeInStartedAt = 0L
    private var autoplayJob: Job? = null
    private var sleepFading = false
    private var lastSaveAt = 0L
    private var tickerRunning = false
    private var pausedAt = 0L

    /** Jumlah lagu berturut-turut yang gagal diputar — rem supaya tidak loop tanpa henti. */
    private var consecutiveFailures = 0

    override fun onCreate() {
        super.onCreate()
        val c = container
        val settings = c.settings.current

        exo = ExoPlayer.Builder(this)
            .setRenderersFactory(
                object : DefaultRenderersFactory(this) {
                    override fun buildAudioSink(
                        context: Context,
                        enableFloatOutput: Boolean,
                        enableAudioTrackPlaybackParams: Boolean,
                    ): AudioSink = DefaultAudioSink.Builder(context)
                        .setEnableFloatOutput(enableFloatOutput)
                        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                        .setAudioProcessors(arrayOf(normalizer))
                        .build()
                }
                    .setEnableDecoderFallback(true)
                    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON),
            )
            .setMediaSourceFactory(
                FreeaseMediaSourceFactory(this, c.mediaCache, c.streamClient, StreamResolver(c.youtube), c.karaoke),
            )
            .setAudioAttributes(MEDIA_ATTRIBUTES, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(30_000, 120_000, 1_000, 2_500)
                    .setPrioritizeTimeOverSizeThresholds(false)
                    .build(),
            )
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
        exo.skipSilenceEnabled = settings.skipSilence
        applyNormalizer(settings)
        container.appScope.launch(Dispatchers.IO) { container.loudness.load() }
        exo.addListener(listener)
        container.audioGainDb = { normalizer.appliedGainDb }
        exo.addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
            override fun onAudioInputFormatChanged(
                eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                format: androidx.media3.common.Format,
                decoderReuseEvaluation: androidx.media3.exoplayer.DecoderReuseEvaluation?,
            ) = publishAudioInfo(format)
        })
        mixer = VolumeMixer(exo)

        val player = FadingPlayer(exo, mixer) { container.settings.current.fadePlayPause }
        val activity = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_OPEN_PLAYER, true),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaLibraryService.MediaLibrarySession.Builder(this, player, SessionCallback())
            .setSessionActivity(activity)
            .setBitmapLoader(CoilBitmapLoader(this, scope))
            .build()

        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this).build().also {
                it.setSmallIcon(R.drawable.ic_notification)
            },
        )

        c.effects.attach(exo.audioSessionId, settings)
        observeSettings()
        observeVideoMode()
        observeKaraoke()
        scope.launch {
            container.assistantDuck.collectLatest { on ->
                // Turun cepat, naik perlahan supaya tidak mengagetkan.
                val from = mixer.duck
                val to = if (on) 0.15f else 1f
                val steps = if (on) 6 else 20
                for (i in 1..steps) {
                    mixer.duck = from + (to - from) * i / steps
                    delay(25)
                }
            }
        }
        observeSleepTimer()
        observeLike()
        lyricsDisplay = LyricsDisplay(this, c, scope) { exo }
        lyricsDisplay.start()
        if (settings.resumeOnStart) restoreQueue()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibraryService.MediaLibrarySession? = session

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_WIDGET) {
            handleWidget(intent.getStringExtra(EXTRA_CMD))
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_ALARM) {
            startAlarm(intent.getIntExtra(AlarmScheduler.EXTRA_ID, -1))
            return START_NOT_STICKY
        }
        if (intent?.action == AlarmScheduler.ACTION_SNOOZE || intent?.action == AlarmScheduler.ACTION_DISMISS) {
            stopAlarm(snooze = intent.action == AlarmScheduler.ACTION_SNOOZE)
            return START_NOT_STICKY
        }
        return super.onStartCommand(intent, flags, startId)
    }

    // ------------------------------------------------------------------ widget

    private var widgetArtId: String? = null
    private var widgetArt: Bitmap? = null
    private var widgetJob: Job? = null

    /** Perintah dari tombol widget layar utama. */
    private fun handleWidget(cmd: String?) {
        val p = session?.player ?: return
        when (cmd) {
            "next" -> if (exo.mediaItemCount > 0) p.seekToNextMediaItem()
            "prev" -> if (exo.mediaItemCount > 0) {
                if (exo.currentPosition > 4_000 || !exo.hasPreviousMediaItem()) p.seekTo(0) else p.seekToPreviousMediaItem()
            }
            "toggle" -> when {
                exo.mediaItemCount == 0 -> restoreAndPlay()
                exo.isPlaying -> p.pause()
                else -> {
                    if (exo.playbackState == Player.STATE_IDLE) exo.prepare()
                    if (exo.playbackState == Player.STATE_ENDED) exo.seekToDefaultPosition()
                    p.play()
                }
            }
        }
        // Service hidup hanya karena widget dan tidak ada yang diputar → jangan dibiarkan menggantung.
        handler.postDelayed({
            if (!exo.playWhenReady && session?.connectedControllers?.isEmpty() != false) stopSelf()
        }, 4_000)
    }

    private fun restoreAndPlay() {
        scope.launch {
            val saved = withContext(Dispatchers.IO) { container.queueStore.load() } ?: return@launch
            if (exo.mediaItemCount == 0) {
                exo.setMediaItems(preparePlayback(saved.songs.map(MediaItems::fromSong)), saved.index, saved.positionMs)
            }
            exo.prepare()
            session?.player?.play()
        }
    }

    /** Kirim judul/artis/sampul/status ke widget — dilewati sepenuhnya kalau tidak ada widget. */
    private var continueJob: Job? = null

    /** Pintasan widget "Lanjutkan" mengikuti lagu terakhir, Daily Mix, dan playlist teratas. */
    private fun updateContinueWidget() {
        if (!com.freease.music.widget.ContinueWidget.hasWidgets(this)) return
        val song = exo.currentMediaItem?.let(MediaItems::toSong)
        continueJob?.cancel()
        continueJob = scope.launch {
            val playlist = withContext(Dispatchers.IO) {
                runCatching { container.library.playlistSummaries().first().firstOrNull() }.getOrNull()
            }
            val mix = container.dailyMix.mixes.value.firstOrNull()
            val tiles = listOfNotNull(
                com.freease.music.widget.ContinueWidget.Tile(song?.title ?: "Lanjutkan", com.freease.music.widget.ContinueWidget.SOURCE_RESUME),
                com.freease.music.widget.ContinueWidget.Tile("Lagu yang Disukai", LibraryTree.LIKED),
                mix?.let { com.freease.music.widget.ContinueWidget.Tile(it.title, "mix:0") }
                    ?: com.freease.music.widget.ContinueWidget.Tile("Baru diputar", LibraryTree.RECENT),
                playlist?.let { com.freease.music.widget.ContinueWidget.Tile("≡  ${it.name}", "${LibraryTree.PLAYLIST_PREFIX}${it.id}") }
                    ?: com.freease.music.widget.ContinueWidget.Tile("Unduhan", LibraryTree.DOWNLOADS),
            )
            com.freease.music.widget.ContinueWidget.push(applicationContext, tiles)
        }
    }

    private fun updateWidget() {
        updateContinueWidget()
        if (!PlayerWidget.hasWidgets(this)) return
        widgetJob?.cancel()
        val song = exo.currentMediaItem?.let(MediaItems::toSong)
        val playing = exo.isPlaying
        widgetJob = scope.launch {
            if (song != null && song.id != widgetArtId) {
                PlayerWidget.push(applicationContext, song.title, song.artist, playing, null)
                widgetArt = withContext(Dispatchers.IO) {
                    runCatching {
                        val req = ImageRequest.Builder(this@PlaybackService).data(song.artworkSmall).allowHardware(false).size(200).build()
                        (imageLoader.execute(req) as? SuccessResult)?.image?.toBitmap()
                    }.getOrNull()
                }
                widgetArtId = song.id
            }
            PlayerWidget.push(applicationContext, song?.title, song?.artist, playing, if (song != null) widgetArt else null)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0 || p.playbackState == Player.STATE_ENDED) {
            stopSelf()
        }
    }

    // ------------------------------------------------------------------ alarm

    private var alarmId = -1
    private var alarmJob: Job? = null
    private var ringtone: android.media.MediaPlayer? = null

    private fun alarmNotification(title: String, text: String): android.app.Notification {
        val nm = getSystemService(android.app.NotificationManager::class.java)
        if (nm.getNotificationChannel(ALARM_CHANNEL) == null) {
            nm.createNotificationChannel(
                android.app.NotificationChannel(ALARM_CHANNEL, "Alarm musik", android.app.NotificationManager.IMPORTANCE_HIGH).apply {
                    setSound(null, null)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                },
            )
        }
        fun action(a: String, req: Int) = PendingIntent.getService(
            this, req, Intent(this, PlaybackService::class.java).setAction(a),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = PendingIntent.getActivity(
            this, 0x42,
            Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(MainActivity.EXTRA_OPEN_PLAYER, true),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return androidx.core.app.NotificationCompat.Builder(this, ALARM_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_ALARM)
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MAX)
            .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Tunda ${AlarmScheduler.SNOOZE_MIN} mnt", action(AlarmScheduler.ACTION_SNOOZE, 0x43))
            .addAction(0, "Matikan", action(AlarmScheduler.ACTION_DISMISS, 0x44))
            .build()
    }

    /** Alarm berbunyi: putar lagu dari sumber pilihan dengan volume naik perlahan. */
    private fun startAlarm(rawId: Int) {
        val id = if (rawId >= AlarmScheduler.SNOOZE_ID_OFFSET) rawId - AlarmScheduler.SNOOZE_ID_OFFSET else rawId
        val alarm = container.alarms.get(id)
        val time = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date())
        // Wajib segera foreground: memuat lagu bisa butuh beberapa detik.
        val notification = alarmNotification("Alarm $time", alarm?.sourceLabel ?: "Freease")
        runCatching {
            androidx.core.app.ServiceCompat.startForeground(
                this, ALARM_NOTIFICATION_ID, notification,
                if (android.os.Build.VERSION.SDK_INT >= 29) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0,
            )
        }
        if (rawId < AlarmScheduler.SNOOZE_ID_OFFSET) container.alarms.fired(id)
        alarmId = id
        alarmJob?.cancel()
        alarmJob = scope.launch {
            val songs = alarmSongs(alarm?.source ?: LibraryTree.LIKED)
                .let { if (alarm?.shuffle != false) it.shuffled() else it }
                .take(100)
            exo.setAudioAttributes(ALARM_ATTRIBUTES, false)
            mixer.fade = 1f
            mixer.sleep = 1f
            mixer.alarm = 0.03f
            if (songs.isNotEmpty()) {
                exo.shuffleModeEnabled = false
                exo.repeatMode = Player.REPEAT_MODE_ALL
                exo.setMediaItems(preparePlayback(songs.map(MediaItems::fromSong)), 0, 0)
                exo.prepare()
                exo.play()
            }
            // Musik tidak bisa diputar (internet mati, link gagal) → nada alarm bawaan, supaya tetap bangun.
            val deadline = System.currentTimeMillis() + 25_000
            while (!exo.isPlaying && System.currentTimeMillis() < deadline && songs.isNotEmpty()) delay(500)
            if (!exo.isPlaying) {
                exo.stop()
                playFallbackTone()
            }
            val fadeMs = ((alarm?.fadeSec ?: 60) * 1000L).coerceAtLeast(1)
            val t0 = System.currentTimeMillis()
            while (true) {
                val f = ((System.currentTimeMillis() - t0).toFloat() / fadeMs).coerceIn(0f, 1f)
                val v = 0.03f + 0.97f * f * f
                mixer.alarm = v
                ringtone?.setVolume(v, v)
                if (f >= 1f) break
                delay(250)
            }
        }
    }

    /** Lagu untuk alarm; kalau offline, utamakan unduhan & musik di HP. */
    private suspend fun alarmSongs(source: String): List<Song> {
        val online = container.isOnline()
        val primary = runCatching { tree.songsOf(source) }.getOrDefault(emptyList())
            .filter { online || it.isLocal || localPath(it.id) != null }
        if (primary.isNotEmpty()) return primary
        for (fallback in listOf(LibraryTree.DOWNLOADS, LibraryTree.LOCAL, LibraryTree.LIKED, LibraryTree.RECENT)) {
            val list = runCatching { tree.songsOf(fallback) }.getOrDefault(emptyList())
                .filter { online || it.isLocal || localPath(it.id) != null }
            if (list.isNotEmpty()) return list
        }
        return emptyList()
    }

    private fun playFallbackTone() {
        val uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
            ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
            ?: return
        ringtone = runCatching {
            android.media.MediaPlayer().apply {
                setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(this@PlaybackService, uri)
                isLooping = true
                setVolume(0.03f, 0.03f)
                prepare()
                start()
            }
        }.getOrNull()
    }

    private fun stopAlarm(snooze: Boolean) {
        if (alarmId < 0 && ringtone == null) {
            getSystemService(android.app.NotificationManager::class.java).cancel(ALARM_NOTIFICATION_ID)
            return
        }
        if (snooze && alarmId >= 0) AlarmScheduler.snooze(this, alarmId)
        alarmJob?.cancel()
        alarmJob = null
        ringtone?.run { runCatching { stop() }; release() }
        ringtone = null
        alarmId = -1
        exo.pause()
        exo.setAudioAttributes(MEDIA_ATTRIBUTES, true)
        mixer.alarm = 1f
        androidx.core.app.ServiceCompat.stopForeground(this, androidx.core.app.ServiceCompat.STOP_FOREGROUND_REMOVE)
        getSystemService(android.app.NotificationManager::class.java).cancel(ALARM_NOTIFICATION_ID)
        if (snooze) container.emitMessage("Alarm ditunda ${AlarmScheduler.SNOOZE_MIN} menit")
    }

    override fun onDestroy() {
        ringtone?.release()
        ringtone = null
        flushListening()
        saveQueue()
        handler.removeCallbacksAndMessages(null)
        if (::lyricsDisplay.isInitialized) lyricsDisplay.stop()
        container.effects.release()
        session?.run {
            player.release()
            release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ settings

    private fun observeSettings() {
        scope.launch {
            var lastMood: String? = null
            var lastSmartShuffle: Boolean? = null
            container.settings.flow.collect { s ->
                if (lastSmartShuffle != null && lastSmartShuffle != s.smartShuffle) {
                    if (s.smartShuffle) maybeSmart() else if (!s.smartMode) dropSmartAhead()
                }
                lastSmartShuffle = s.smartShuffle
                exo.skipSilenceEnabled = s.skipSilence
                applyNormalizer(s)
                container.effects.apply(s)
                val gain = s.vocalLevel.coerceIn(0, 100) / 100f
                if (gain != container.karaoke.vocalGain) {
                    container.karaoke.vocalGain = gain
                    refreshKaraokeCurrent()
                }
                // Bass boost penuh ≈ +6 dB di frekuensi rendah → turunkan volume keseluruhan sampai −4 dB.
                mixer.headroom = if (s.eqEnabled && s.bassBoost > 0) Math.pow(10.0, -4.0 * s.bassBoost / 1000 / 20).toFloat() else 1f
                if (lastMood != null && lastMood != s.smartMood) onMoodChanged()
                lastMood = s.smartMood
            }
        }
    }

    /** Kecepatan & nada yang diingat untuk lagu ini, atau setelan umum. */
    private fun applySongParams(id: String?) {
        val p = container.songParams.effective(id)
        val now = exo.playbackParameters
        if (now.speed != p.speed || now.pitch != p.pitch) {
            exo.playbackParameters = androidx.media3.common.PlaybackParameters(p.speed, p.pitch)
        }
    }

    private fun applyNormalizer(s: com.freease.music.data.prefs.AppSettings) {
        normalizer.enabled = s.normalizeVolume
        normalizer.targetLufs = when (s.normalizeLevel) {
            0 -> -19.0
            2 -> -11.0
            else -> -14.0
        }
    }

    private fun observeVideoMode() {
        scope.launch {
            container.videoMode.drop(1).collect {
                // Video & karaoke tidak bisa bersamaan: karaoke hanya audio.
                if (it && container.karaokeMode.value) container.karaokeMode.value = false
                swapCurrent(it)
            }
        }
    }

    private fun observeSleepTimer() {
        // Timer berbasis lagu: ExoPlayer sendiri yang berhenti tepat di akhir lagu (juga saat ulangi-satu
        // atau lagu terakhir), tanpa sempat memutar awal lagu berikutnya.
        scope.launch {
            container.sleepTimer.state.map { it.stopAtEndOfTrack }.distinctUntilChanged().collect {
                exo.pauseAtEndOfMediaItems = it
            }
        }
        scope.launch {
            container.sleepTimer.state.map { it.endsAt }.distinctUntilChanged().collectLatest { endsAt ->
                mixer.sleep = 1f
                sleepFading = false
                if (endsAt == null) return@collectLatest
                val fadeMs = 8_000L
                delay((endsAt - System.currentTimeMillis() - fadeMs).coerceAtLeast(0))
                sleepFading = true
                val steps = 40
                for (i in steps downTo 0) {
                    mixer.sleep = i / steps.toFloat()
                    delay(fadeMs / steps)
                }
                exo.pause()
                mixer.sleep = 1f
                sleepFading = false
                container.sleepTimer.cancel()
            }
        }
    }

    private fun effectiveQuality(): AudioQuality {
        val s = container.settings.current
        // Baterai hampir habis: dekode & unduh lebih ringan (paling tinggi Normal).
        if (container.batteryLow() && s.audioQuality == AudioQuality.MAX) return AudioQuality.NORMAL
        if (!s.saverOnCellular || !container.isMetered()) return s.audioQuality
        // Di seluler pakai kualitas seluler, tapi tidak pernah lebih tinggi dari pilihan utama.
        return if (s.cellularQuality.ordinal >= s.audioQuality.ordinal) s.cellularQuality else s.audioQuality
    }

    private suspend fun localPath(id: String): String? = withContext(Dispatchers.IO) {
        container.db.songs().get(id)?.takeIf { it.downloadState == DownloadState.DONE }?.downloadPath
    }

    private suspend fun preparePlayback(items: List<MediaItem>): MutableList<MediaItem> {
        val video = container.videoMode.value
        val s = container.settings.current
        val q = effectiveQuality()
        return items.map { item ->
            MediaItems.forPlayback(item, video, localPath(item.mediaId), q, s.videoQuality)
        }.toMutableList()
    }

    private fun swapCurrent(video: Boolean) {
        val item = exo.currentMediaItem ?: return
        if (MediaItems.isLive(item) || MediaItems.isVideo(item) == video) return
        if (com.freease.music.data.local.LocalSongs.isLocal(item.mediaId)) return
        val index = exo.currentMediaItemIndex
        val position = exo.currentPosition
        scope.launch {
            val s = container.settings.current
            val replacement = MediaItems.forPlayback(
                item, video, if (video) null else localPath(item.mediaId), effectiveQuality(), s.videoQuality,
            )
            if (exo.currentMediaItemIndex != index || exo.currentMediaItem?.mediaId != item.mediaId) return@launch
            exo.replaceMediaItem(index, replacement)
            exo.seekTo(index, position)
        }
    }

    // ------------------------------------------------------------------ info audio

    private fun publishAudioInfo(format: androidx.media3.common.Format) {
        val item = exo.currentMediaItem ?: return
        val id = item.mediaId
        val uri = item.localConfiguration?.uri
        val karaoke = MediaItems.isKaraoke(item)
        val stream = StreamResolver.lastAudio[id]
        val source = when {
            karaoke -> "Karaoke AI · model ${karaokeModel.label}"
            uri?.scheme == "content" -> "File di HP"
            uri?.scheme == "file" -> "Unduhan offline"
            MediaItems.isLive(item) -> "Siaran langsung"
            else -> {
                val key = item.localConfiguration?.customCacheKey
                val cached = key != null && runCatching { container.mediaCache.getCachedBytes(key, 0, C.LENGTH_UNSET.toLong()) > 0 }.getOrDefault(false)
                "Streaming YouTube" + if (cached) " · sebagian dari cache" else ""
            }
        }
        val bitrate = when {
            format.averageBitrate > 0 -> format.averageBitrate / 1000
            format.bitrate > 0 -> format.bitrate / 1000
            karaoke -> format.sampleRate * format.channelCount * 16 / 1000
            else -> stream?.bitrateKbps ?: 0
        }
        val loudId = if (karaoke) "$id#k" else id
        val s = container.settings.current
        container.audioInfo.value = AudioInfo(
            songId = id,
            source = source,
            codec = AudioInfo.codecName(format.sampleMimeType, format.codecs),
            sampleRate = format.sampleRate,
            channels = format.channelCount,
            bitrateKbps = bitrate,
            loudnessLufs = container.loudness.get(loudId),
            targetLufs = if (s.normalizeVolume) normalizer.targetLufs else null,
        )
    }

    // ------------------------------------------------------------------ karaoke (AI)

    private var karaokeTicker: Job? = null
    private val karaokeModel get() = com.freease.music.karaoke.MdxModel.byId(container.settings.current.karaokeModel)

    private fun observeKaraoke() {
        scope.launch {
            container.karaokeMode.collect { on ->
                karaokeTicker?.cancel()
                if (on) {
                    if (container.videoMode.value) container.videoMode.value = false
                    karaokeTicker = scope.launch {
                        while (true) {
                            karaokeTick()
                            delay(1_000)
                        }
                    }
                } else {
                    container.karaoke.cancelAll()
                    revertKaraoke(onlyCurrent = false, play = null)
                    container.karaoke.closeSession()
                }
            }
        }
    }

    /**
     * Tiap detik selama Mode Karaoke aktif: siapkan lagu sekarang (dan berikutnya), lalu ganti ke versi
     * karaoke begitu bisa diputar tanpa tersendat. Lagu berikutnya yang sudah jadi langsung diganti di
     * antrean supaya perpindahan lagu tetap mulus.
     */
    private fun karaokeTick() {
        val engine = container.karaoke
        val m = karaokeModel
        val ready = engine.isDownloaded(m)
        val item = exo.currentMediaItem ?: return
        if (MediaItems.isLive(item)) return
        val song = MediaItems.toSong(item)
        // Karaoke tersimpan bisa diputar walau model AI belum/tidak terpasang.
        val saved = engine.library.has(song.id)
        if (ready && !saved) engine.request(m, song, first = true)
        // Volume vokal > 0 untuk lagu tersimpan: butuh trek vokal → pulihkan dari simpanan lalu muat ulang.
        if (saved && engine.vocalGain > 0f && engine.output(m, song.id) == null && engine.library.vocalFile(song.id) != null) {
            ensureKaraokeStems(song.id) { if (exo.currentMediaItem?.mediaId == song.id) refreshKaraokeCurrent() }
        }
        if (!MediaItems.isKaraoke(item) && (saved || (ready && engine.canPlay(m, song.id, exo.currentPosition)))) {
            val index = exo.currentMediaItemIndex
            val position = exo.currentPosition
            exo.replaceMediaItem(index, MediaItems.forKaraoke(item, m))
            exo.seekTo(index, position)
            normalizer.beginTrack("${song.id}#k", container.loudness.get("${song.id}#k"))
        }
        val nextIndex = exo.nextMediaItemIndex
        if (nextIndex != C.INDEX_UNSET) {
            val next = exo.getMediaItemAt(nextIndex)
            if (!MediaItems.isLive(next)) {
                val ns = MediaItems.toSong(next)
                if (engine.library.has(ns.id) || (ready && engine.isComplete(m, ns.id))) {
                    if (!MediaItems.isKaraoke(next)) exo.replaceMediaItem(nextIndex, MediaItems.forKaraoke(next, m))
                } else if (ready && engine.isComplete(m, song.id)) {
                    engine.request(m, ns, first = false)
                }
            }
        }
    }

    private val restoring = HashSet<String>()

    /** Muat ulang item karaoke yang sedang diputar (buffer lama dibuang) supaya volume vokal baru langsung terdengar. */
    private fun refreshKaraokeCurrent() {
        val item = exo.currentMediaItem ?: return
        if (!MediaItems.isKaraoke(item)) return
        val index = exo.currentMediaItemIndex
        val position = exo.currentPosition
        // URI berbeda (parameter g) memaksa sumber dibuat ulang; item yang sama persis hanya diperbarui tanpa membaca ulang.
        val uri = item.localConfiguration?.uri ?: return
        val fresh = uri.buildUpon().clearQuery().appendQueryParameter("g", System.nanoTime().toString()).build()
        exo.replaceMediaItem(index, item.buildUpon().setUri(fresh).build())
        exo.seekTo(index, position)
    }

    /** Karaoke tersimpan + volume vokal/skor → pulihkan WAV & trek vokal dari simpanan (sekali per lagu). */
    fun ensureKaraokeStems(id: String, then: () -> Unit = {}) {
        val m = karaokeModel
        if (!restoring.add(id)) return
        scope.launch {
            val ok = container.karaoke.restoreSaved(m, id)
            restoring.remove(id)
            if (ok) then()
        }
    }

    /** Kembalikan item karaoke ke versi aslinya (lagu yang sedang diputar tetap di posisinya). */
    private fun revertKaraoke(onlyCurrent: Boolean, play: Boolean?) {
        val current = exo.currentMediaItemIndex
        val indices = if (onlyCurrent) listOf(current) else (0 until exo.mediaItemCount).toList()
        val targets = indices.filter { it in 0 until exo.mediaItemCount && MediaItems.isKaraoke(exo.getMediaItemAt(it)) }
        if (targets.isEmpty()) return
        val position = exo.currentPosition
        scope.launch {
            val s = container.settings.current
            for (i in targets) {
                if (i >= exo.mediaItemCount) continue
                val it = exo.getMediaItemAt(i)
                if (!MediaItems.isKaraoke(it)) continue
                exo.replaceMediaItem(i, MediaItems.forPlayback(it, false, localPath(it.mediaId), effectiveQuality(), s.videoQuality))
                if (i == current) {
                    exo.seekTo(i, position)
                    normalizer.beginTrack(it.mediaId, container.loudness.get(it.mediaId))
                }
            }
            if (play == true) {
                exo.prepare()
                exo.play()
            }
        }
    }

    // ------------------------------------------------------------------ listener

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val prevSong = trackingSong
            val newId = mediaItem?.mediaId
            if (newId != null && newId == trackingSong?.id && reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
                return // item yang sama diganti (mis. mode video) — bukan lagu baru
            }
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) container.touchInteraction()
            flushListening(reason)
            val loudId = if (mediaItem != null && MediaItems.isKaraoke(mediaItem)) "$newId#k" else newId
            normalizer.beginTrack(loudId, loudId?.let(container.loudness::get))
            applySongParams(newId)
            trackingSong = mediaItem?.let(MediaItems::toSong)
            loadNonMusic(mediaItem)
            lyricsDisplay.song.value = trackingSong
            trackingSong?.let { song -> scope.launch { container.library.touch(song) } }

            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) {
                container.sleepTimer.onTrackFinished()
            }
            val gapless = mediaItem != null && sameAlbum(prevSong, MediaItems.toSong(mediaItem))
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && container.settings.current.crossfadeSec > 0 && !gapless) {
                fadeInStartedAt = System.currentTimeMillis()
            }
            mediaItem?.let {
                if (!com.freease.music.data.local.LocalSongs.isLocal(it.mediaId) && MediaItems.isVideo(it) != container.videoMode.value) {
                    swapCurrent(container.videoMode.value)
                }
            }
            updateLikeButton()
            updateWidget()
            maybeAutoplay()
            saveQueue()
        }

        override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
            if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) {
                maybeAutoplay()
                saveQueue()
            }
        }

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
            if (!container.settings.current.smartShuffle) return
            if (shuffleModeEnabled) maybeSmart() else if (!container.settings.current.smartMode) dropSmartAhead()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            updateWidget()
            lyricsDisplay.playing.value = isPlaying
            if (isPlaying) {
                consecutiveFailures = 0
                startTicker()
                // Habis jeda lama (mis. main game), pastikan efek suara masih sehat.
                if (System.currentTimeMillis() - pausedAt > 20_000) {
                    container.effects.rebuild(exo.audioSessionId, container.settings.current)
                }
            } else {
                pausedAt = System.currentTimeMillis()
                saveQueue()
            }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) container.touchInteraction()
            // Berhenti tepat di akhir lagu karena timer "akhir lagu" / "setelah N lagu".
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                container.sleepTimer.onStoppedAtEnd()
            }
        }

        override fun onAudioSessionIdChanged(audioSessionId: Int) {
            container.effects.attach(audioSessionId, container.settings.current)
        }

        override fun onPlayerError(error: PlaybackException) {
            val item = exo.currentMediaItem ?: return
            val id = item.mediaId
            if (MediaItems.isKaraoke(item)) {
                // Versi karaoke gagal: kembali ke lagu aslinya, jangan lewati lagunya.
                container.emitMessage("Karaoke gagal untuk lagu ini — diputar versi asli")
                revertKaraoke(onlyCurrent = true, play = true)
                return
            }
            val http = generateSequence<Throwable>(error) { it.cause }
                .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
                .firstOrNull()
            val networkish = error.errorCode in PlaybackException.ERROR_CODE_IO_UNSPECIFIED..PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE ||
                error.errorCode in PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED..PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED
            val tries = retries[id] ?: 0
            if ((http != null || networkish) && tries < 2 && consecutiveFailures < MAX_FAILURES) {
                retries[id] = tries + 1
                container.youtube.invalidate(id)
                if (error.errorCode >= PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED) {
                    // Isi cache bisa tercampur format lain — buang supaya diambil ulang bersih.
                    item.localConfiguration?.customCacheKey?.let { key ->
                        runCatching { container.mediaCache.removeResource(key) }
                    }
                }
                exo.prepare()
                exo.play()
                return
            }
            val reasonText = when {
                http?.responseCode == 403 -> "Akses stream ditolak YouTube"
                !container.isOnline() -> "Tidak ada koneksi internet"
                else -> error.localizedMessage ?: "Gagal memutar"
            }
            consecutiveFailures++
            if (consecutiveFailures >= MAX_FAILURES || !container.isOnline()) {
                // Kemungkinan masalah jaringan/YouTube, bukan lagunya — berhenti, jangan loop.
                container.emitMessage("Pemutaran dihentikan: $reasonText. Coba lagi sebentar lagi.")
                consecutiveFailures = 0
                return
            }
            container.emitMessage("Lewati \"${item.mediaMetadata.title}\": $reasonText")
            if (exo.hasNextMediaItem()) {
                exo.seekToNextMediaItem()
                exo.prepare()
                exo.play()
            }
        }
    }

    // ------------------------------------------------------------------ ticker

    /**
     * Penghitung waktu dengar + crossfade. Hanya jalan selama musik berputar; tiap 1 detik,
     * dan 10×/detik hanya di detik-detik crossfade supaya volume berubah halus.
     */
    private val ticker = object : Runnable {
        override fun run() {
            if (!exo.isPlaying) {
                tickerRunning = false
                lastTick = 0
                return
            }
            val now = System.currentTimeMillis()
            if (lastTick > 0) listenedMs += (now - lastTick)
            lastTick = now
            val fading = updateCrossfade(now)
            checkNonMusic()
            checkIdleSleep(now)
            if (now - lastSaveAt > 30_000) {
                lastSaveAt = now
                saveQueue()
            }
            handler.postDelayed(this, if (fading) 100 else 1000)
        }
    }

    private var idleJob: Job? = null

    /**
     * Tidur otomatis: kalau tidak ada sentuhan/kontrol selama batas waktu yang dipilih, volume
     * dipelankan 20 detik lalu musik dijeda. Menyentuh app/notifikasi di tengah jalan membatalkannya.
     */
    private fun checkIdleSleep(now: Long) {
        val limitMin = container.settings.current.idleSleepMin
        if (limitMin <= 0 || idleJob?.isActive == true || container.sleepTimer.state.value.active) return
        if (now - container.lastInteraction < limitMin * 60_000L) return
        idleJob = scope.launch {
            val startedAt = System.currentTimeMillis()
            val steps = 40
            for (i in steps downTo 0) {
                if (container.lastInteraction > startedAt || !exo.isPlaying) {
                    mixer.sleep = 1f
                    return@launch
                }
                mixer.sleep = i / steps.toFloat()
                delay(500)
            }
            exo.pause()
            mixer.sleep = 1f
            container.emitMessage("Musik dijeda karena lama tidak ada aktivitas")
        }
    }

    private fun startTicker() {
        if (tickerRunning) return
        tickerRunning = true
        lastTick = System.currentTimeMillis()
        handler.post(ticker)
    }

    /**
     * Crossfade pintar: lagu berurutan dari album yang sama (mis. album live/konsep) disambung tanpa
     * fade supaya transisinya utuh seperti di albumnya.
     */
    private fun sameAlbum(a: Song?, b: Song?): Boolean {
        if (!container.settings.current.smartCrossfade || a == null || b == null) return false
        val albumA = a.album?.trim()?.lowercase().orEmpty()
        return albumA.isNotEmpty() && albumA == b.album?.trim()?.lowercase() && a.artist.equals(b.artist, ignoreCase = true)
    }

    /** @return true kalau sedang (atau hampir) dalam fase fade, supaya ticker dipercepat. */
    private fun updateCrossfade(now: Long): Boolean {
        val cfMs = container.settings.current.crossfadeSec * 1000L
        if (cfMs <= 0 || exo.currentMediaItem?.let(MediaItems::isLive) == true) {
            if (mixer.crossfade != 1f) mixer.crossfade = 1f
            return false
        }
        val inRamp = cfMs / 2
        val fadeIn = if (fadeInStartedAt > 0) ((now - fadeInStartedAt).toFloat() / inRamp).coerceIn(0f, 1f) else 1f
        if (fadeIn >= 1f) fadeInStartedAt = 0
        val dur = exo.duration
        val nextIndex = exo.nextMediaItemIndex
        val gaplessNext = nextIndex != C.INDEX_UNSET && exo.currentMediaItem?.let { cur ->
            sameAlbum(MediaItems.toSong(cur), MediaItems.toSong(exo.getMediaItemAt(nextIndex)))
        } == true
        val fadeOut = if (dur != C.TIME_UNSET && dur > cfMs * 2 && exo.hasNextMediaItem() &&
            exo.repeatMode != Player.REPEAT_MODE_ONE && !gaplessNext
        ) {
            ((dur - exo.currentPosition).toFloat() / cfMs).coerceIn(0f, 1f)
        } else 1f
        val value = minOf(fadeIn, fadeOut)
        if (value != mixer.crossfade) mixer.crossfade = value
        val nearEnd = dur != C.TIME_UNSET && dur - exo.currentPosition < cfMs + 1500
        return fadeInStartedAt > 0 || nearEnd
    }

    private fun flushListening(reason: Int = REASON_NONE) {
        val song = trackingSong ?: return
        val ms = listenedMs
        listenedMs = 0
        lastTick = 0
        val threshold = if (song.durationSec in 1..59) song.durationSec * 500 else 15_000
        if (ms >= threshold) {
            container.appScope.launch { container.library.recordPlay(song, ms) }
        }
        // Freease Pintar selalu belajar dari lewati/selesai, juga saat fiturnya sedang dimatikan.
        if (reason != REASON_NONE) {
            container.smart.onSongEnded(
                song, ms,
                manualSkip = reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK,
                autoEnd = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT,
            )
        }
    }

    // ------------------------------------------------------------------ autoplay

    private fun maybeAutoplay() {
        trimPlayedHistory()
        if (smartActive()) {
            maybeSmart()
            return
        }
        val s = container.settings.current
        if (!s.autoplay || exo.repeatMode != Player.REPEAT_MODE_OFF || exo.mediaItemCount == 0) return
        if (exo.mediaItemCount >= MAX_QUEUE) return
        if (exo.currentMediaItemIndex < exo.mediaItemCount - 2) return
        if (autoplayJob?.isActive == true) return
        val seed = exo.currentMediaItem?.mediaId ?: return
        autoplayJob = scope.launch {
            val existing = (0 until exo.mediaItemCount).map { exo.getMediaItemAt(it).mediaId }.toHashSet()
            val related = runCatching { container.youtube.related(seed) }.getOrDefault(emptyList())
                .filter { it.id !in existing }
                .distinctBy { it.title.lowercase() }
                .take(10)
            if (related.isEmpty()) return@launch
            val items = preparePlayback(related.map(MediaItems::fromSong))
            exo.addMediaItems(items)
        }
    }

    // ------------------------------------------------------------------ Freease Pintar

    private var smartJob: Job? = null
    private var smartRetryAt = 0L
    private var moodKick = false

    /** Suasana diganti: buang sisipan lama di depan lalu langsung isi dengan pilihan bersuasana baru. */
    private fun onMoodChanged() {
        smartJob?.cancel()
        smartRetryAt = 0
        val index = exo.currentMediaItemIndex
        for (i in exo.mediaItemCount - 1 downTo index + 1) {
            if (MediaItems.isSmart(exo.getMediaItemAt(i))) exo.removeMediaItem(i)
        }
        moodKick = container.settings.current.smartMode && container.settings.current.smartMood.isNotEmpty()
        maybeSmart()
    }

    /**
     * Menjaga pola "beberapa lagu pilihanmu, lalu satu lagu pilihan Freease Pintar" di
     * antrean ke depan, dan melanjutkan sebagai radio pintar saat antrean hampir habis.
     * Hanya satu permintaan dalam satu waktu, maksimal 3 sisipan di depan.
     */
    /** Smart Shuffle aktif = mode acak + pilihan Smart Shuffle di tombol acak. */
    private fun smartShuffleOn() = container.settings.current.smartShuffle && exo.shuffleModeEnabled

    private fun smartActive() = container.settings.current.smartMode || smartShuffleOn()

    /** Smart Shuffle dimatikan: buang rekomendasi yang belum diputar. */
    private fun dropSmartAhead() {
        smartJob?.cancel()
        smartRetryAt = 0
        val index = exo.currentMediaItemIndex
        for (i in exo.mediaItemCount - 1 downTo 0) {
            if (i != index && MediaItems.isSmart(exo.getMediaItemAt(i))) exo.removeMediaItem(i)
        }
    }

    private fun maybeSmart() {
        val s = container.settings.current
        if (!smartActive() || exo.mediaItemCount == 0 || exo.repeatMode != Player.REPEAT_MODE_OFF) return
        if (exo.currentMediaItem?.let(MediaItems::isLive) == true || exo.mediaItemCount >= MAX_QUEUE) return
        if (smartJob?.isActive == true || System.currentTimeMillis() < smartRetryAt) return

        // Urutan putar ke depan, sudah memperhitungkan mode acak.
        val timeline = exo.currentTimeline
        val order = ArrayList<Int>()
        var cursor = exo.currentMediaItemIndex
        while (order.size < 24) {
            cursor = timeline.getNextWindowIndex(cursor, exo.repeatMode, exo.shuffleModeEnabled)
            if (cursor == C.INDEX_UNSET) break
            order += cursor
        }
        val smartAhead = order.count { MediaItems.isSmart(exo.getMediaItemAt(it)) }
        val mood = SmartMood.byId(s.smartMood)
        val gap = mood?.gap ?: container.smart.session.gap

        var insertAt = -1
        var count = 1
        if (order.size <= 1) {
            if (!s.autoplay || smartAhead >= 2) return
            insertAt = exo.mediaItemCount
            count = 3
        } else if (smartAhead < 3) {
            if (smartShuffleOn()) {
                // Kira-kira 1 rekomendasi tiap 3 lagu; ExoPlayer menyebarkan item baru ke posisi acak.
                val want = (order.size / 3).coerceIn(1, 3)
                if (smartAhead >= want) return
                insertAt = exo.mediaItemCount
                count = (want - smartAhead).coerceAtMost(2)
            } else if (exo.shuffleModeEnabled) {
                // Urutan acak tidak bisa ditentukan posisinya; cukup pastikan selalu ada satu di depan.
                if (smartAhead >= 1) return
                insertAt = exo.mediaItemCount
            } else {
                var run = 0
                for (p in 0..order.size) {
                    val smart = p < order.size && MediaItems.isSmart(exo.getMediaItemAt(order[p]))
                    if (smart) { run = 0; continue }
                    if (run >= gap) {
                        insertAt = if (p < order.size) order[p] else exo.mediaItemCount
                        break
                    }
                    if (p < order.size) run++
                }
            }
        }
        if (moodKick) {
            insertAt = exo.currentMediaItemIndex + 1
            count = 3
        }
        if (insertAt < 0) return

        val snapshot = (0 until exo.mediaItemCount).map { MediaItems.toSong(exo.getMediaItemAt(it)) }
        val index = exo.currentMediaItemIndex
        val anchorId = exo.currentMediaItem?.mediaId
        val playlistWide = smartShuffleOn() && mood == null
        smartJob = scope.launch {
            val picks = runCatching { container.smart.pick(snapshot, index, count, mood, playlistWide) }.getOrDefault(emptyList())
            if (picks.isEmpty()) {
                moodKick = false
                smartRetryAt = System.currentTimeMillis() + 20_000
                return@launch
            }
            if (exo.currentMediaItem?.mediaId != anchorId) {
                handler.post { maybeSmart() } // lagu sudah berganti selama menunggu; hitung ulang
                return@launch
            }
            moodKick = false
            val items = preparePlayback(picks.map(MediaItems::fromSong))
            exo.addMediaItems(insertAt.coerceAtMost(exo.mediaItemCount), items)
        }
    }

    /**
     * Lagu yang sudah lewat jauh di belakang dibuang dari antrean (tetap ada di Riwayat),
     * supaya antrean dari putar otomatis tidak tumbuh tanpa batas selama berjam-jam.
     */
    private fun trimPlayedHistory() {
        val index = exo.currentMediaItemIndex
        if (exo.shuffleModeEnabled || index < KEEP_BEHIND * 2) return
        exo.removeMediaItems(0, index - KEEP_BEHIND)
    }

    // ------------------------------------------------------------------ queue persistence

    private fun saveQueue() {
        if (exo.mediaItemCount == 0) return
        val songs = (0 until exo.mediaItemCount).map { MediaItems.toSong(exo.getMediaItemAt(it)) }
        val q = SavedQueue(songs, exo.currentMediaItemIndex, exo.currentPosition.coerceAtLeast(0))
        container.appScope.launch(Dispatchers.IO) { container.queueStore.save(q) }
    }

    private fun restoreQueue() {
        scope.launch {
            val saved = withContext(Dispatchers.IO) { container.queueStore.load() } ?: return@launch
            if (exo.mediaItemCount > 0) return@launch
            val items = preparePlayback(saved.songs.map(MediaItems::fromSong))
            exo.setMediaItems(items, saved.index, saved.positionMs)
        }
    }

    // ------------------------------------------------------------------ like button

    private val currentId = MutableStateFlow<String?>(null)
    private var currentLiked = false

    private fun observeLike() {
        scope.launch {
            currentId.flatMapLatest { id ->
                if (id == null) flowOf(false) else container.library.isLiked(id)
            }.distinctUntilChanged().collect { liked ->
                currentLiked = liked
                updateLikeButton()
            }
        }
    }

    private fun updateLikeButton() {
        currentId.value = exo.currentMediaItem?.mediaId
        val liked = currentLiked
        run {
            val button = CommandButton.Builder(
                if (liked) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED,
            )
                .setDisplayName(if (liked) "Hapus dari Disukai" else "Suka")
                .setSessionCommand(likeCommand)
                .build()
            session?.setCustomLayout(ImmutableList.of(button))
        }
    }

    private inner class SessionCallback : MediaLibraryService.MediaLibrarySession.Callback {
        private var headsetLongPress = false

        /**
         * Tekan lama tombol earphone (play/pause) → Freease Smart terbuka, selama aplikasi tampil di layar.
         * Tekan 2× = lagu berikutnya dan 3× = sebelumnya tetap ditangani Media3 seperti biasa.
         */
        override fun onMediaButtonEvent(session: MediaSession, controllerInfo: MediaSession.ControllerInfo, intent: Intent): Boolean {
            val ev = androidx.core.content.IntentCompat.getParcelableExtra(intent, Intent.EXTRA_KEY_EVENT, android.view.KeyEvent::class.java)
                ?: return false
            if (ev.keyCode != android.view.KeyEvent.KEYCODE_HEADSETHOOK && ev.keyCode != android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) return false
            if (ev.action == android.view.KeyEvent.ACTION_DOWN && ev.repeatCount > 0) {
                if (!headsetLongPress && container.appVisible.value) {
                    headsetLongPress = true
                    container.assistantRequests.tryEmit(Unit)
                }
                return headsetLongPress
            }
            if (ev.action == android.view.KeyEvent.ACTION_UP && headsetLongPress) {
                headsetLongPress = false
                return true
            }
            return false
        }

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(likeCommand)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .build()
        }

        override fun onPostConnect(session: MediaSession, controller: MediaSession.ControllerInfo) {
            updateLikeButton()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction == ACTION_LIKE) {
                val item = exo.currentMediaItem
                    ?: return Futures.immediateFuture(SessionResult(androidx.media3.session.SessionError.ERROR_BAD_VALUE))
                return scope.future {
                    container.library.toggleLike(MediaItems.toSong(item))
                    SessionResult(SessionResult.RESULT_SUCCESS)
                }
            }
            return super.onCustomCommand(session, controller, customCommand, args)
        }

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = scope.future {
            voiceSearch(mediaItems)?.let { return@future preparePlayback(it.map(MediaItems::fromSong)) }
            preparePlayback(fromBrowser(mediaItems))
        }

        /**
         * Perintah suara ("Ok Google, putar Tulus di Freease", Android Auto): item tanpa id yang membawa
         * kata pencarian → hasil pencarian lagu; kata kosong → Lagu yang Disukai diacak.
         */
        private suspend fun voiceSearch(items: List<MediaItem>): List<Song>? {
            val item = items.singleOrNull() ?: return null
            val query = item.requestMetadata.searchQuery ?: return null
            if (item.mediaId.isNotEmpty() && item.mediaId != query) return null
            return container.voiceQueue(query).ifEmpty { null }
        }

        /** Item dari pohon jelajah ("folder|videoId") → item lagu biasa beserta datanya. */
        private suspend fun fromBrowser(items: List<MediaItem>): List<MediaItem> = items.map { item ->
            if (LibraryTree.SEP !in item.mediaId) return@map item
            val real = tree.realId(item.mediaId)
            val song = withContext(Dispatchers.IO) { container.db.songs().get(real)?.toSong() }
                ?: MediaItems.toSong(item).copy(id = real)
            MediaItems.fromSong(song)
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = scope.future {
            voiceSearch(mediaItems)?.let { songs ->
                return@future MediaSession.MediaItemsWithStartPosition(preparePlayback(songs.map(MediaItems::fromSong)), 0, 0L)
            }
            // Dipilih dari Android Auto: putar seluruh folder mulai dari lagu itu.
            val expanded = tree.expand(mediaItems)
            if (expanded != null) {
                val (songs, index) = expanded
                MediaSession.MediaItemsWithStartPosition(preparePlayback(songs.map(MediaItems::fromSong)), index, 0L)
            } else {
                MediaSession.MediaItemsWithStartPosition(preparePlayback(fromBrowser(mediaItems)), startIndex, startPositionMs)
            }
        }

        override fun onGetLibraryRoot(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(LibraryResult.ofItem(tree.root(), params))

        override fun onGetChildren(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
            LibraryResult.ofItemList(paged(tree.children(parentId), page, pageSize), params)
        }

        override fun onGetItem(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> = scope.future {
            val found = (tree.children(LibraryTree.ROOT) + listOf(tree.root())).firstOrNull { it.mediaId == mediaId }
                ?: withContext(Dispatchers.IO) { container.db.songs().get(tree.realId(mediaId))?.toSong() }?.let(MediaItems::fromSong)
            if (found != null) LibraryResult.ofItem(found, null) else LibraryResult.ofError(androidx.media3.session.SessionError.ERROR_BAD_VALUE)
        }

        override fun onSearch(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<Void>> = scope.future {
            val results = tree.search(query)
            session.notifySearchResultChanged(browser, query, results.size, params)
            LibraryResult.ofVoid()
        }

        override fun onGetSearchResult(
            session: MediaLibraryService.MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            page: Int,
            pageSize: Int,
            params: MediaLibraryService.LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
            val cached = tree.children(LibraryTree.SEARCH_PREFIX + query)
            LibraryResult.ofItemList(paged(cached.ifEmpty { tree.search(query) }, page, pageSize), params)
        }

        private fun paged(all: List<MediaItem>, page: Int, pageSize: Int): ImmutableList<MediaItem> {
            val from = (page.toLong() * pageSize).coerceAtMost(all.size.toLong()).toInt()
            val to = (from.toLong() + pageSize).coerceAtMost(all.size.toLong()).toInt()
            return ImmutableList.copyOf(all.subList(from, to))
        }

        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = scope.future {
            val saved = withContext(Dispatchers.IO) { container.queueStore.load() }
                ?: throw UnsupportedOperationException("Tidak ada antrian tersimpan")
            MediaSession.MediaItemsWithStartPosition(
                preparePlayback(saved.songs.map(MediaItems::fromSong)), saved.index, saved.positionMs,
            )
        }
    }

    companion object {
        const val ACTION_LIKE = "freease.LIKE"
        const val ACTION_WIDGET = "freease.WIDGET"
        const val ACTION_ALARM = "freease.ALARM"
        private const val ALARM_CHANNEL = "alarm"
        private const val ALARM_NOTIFICATION_ID = 0x414C
        private val MEDIA_ATTRIBUTES = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
        private val ALARM_ATTRIBUTES = AudioAttributes.Builder()
            .setUsage(C.USAGE_ALARM).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
        const val EXTRA_CMD = "cmd"
        private const val REASON_NONE = -1
        private const val MAX_FAILURES = 3
        private const val MAX_QUEUE = 300
        private const val KEEP_BEHIND = 30
    }
}
