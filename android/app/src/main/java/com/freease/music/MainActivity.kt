package com.freease.music

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import com.freease.music.data.youtube.YouTubeRepository
import com.freease.music.ui.FreeaseRoot
import com.freease.music.ui.navigation.AppActions
import kotlinx.coroutines.launch

@UnstableApi
class MainActivity : ComponentActivity() {
    private val container get() = (application as FreeaseApp).container
    private var actions: AppActions? = null
    private var pendingIntent: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) pendingIntent = intent
        setContent {
            FreeaseRoot(container) { a ->
                actions = a
                pendingIntent?.let { handleIntent(it) }
                pendingIntent = null
            }
        }
    }

    override fun dispatchTouchEvent(ev: android.view.MotionEvent): Boolean {
        if (ev.action == android.view.MotionEvent.ACTION_DOWN) container.touchInteraction()
        return super.dispatchTouchEvent(ev)
    }

    /** Keluar dari aplikasi saat video sedang tampil & diputar → lanjut di jendela kecil (PiP). */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val state = container.player.state.value
        if (!container.videoOnScreen.value || !state.isPlaying || !state.hasVideoTrack && !state.isVideo) return
        val w = state.videoWidth.takeIf { it > 0 } ?: 16
        val h = state.videoHeight.takeIf { it > 0 } ?: 9
        // Rasio PiP yang diizinkan Android: 1:2,39 sampai 2,39:1.
        val ratio = android.util.Rational(w, h).let { r ->
            when {
                r.toFloat() > 2.39f -> android.util.Rational(239, 100)
                r.toFloat() < 1 / 2.39f -> android.util.Rational(100, 239)
                else -> r
            }
        }
        runCatching {
            enterPictureInPictureMode(android.app.PictureInPictureParams.Builder().setAspectRatio(ratio).build())
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        container.pipMode.value = isInPictureInPictureMode
    }

    override fun onStart() {
        super.onStart()
        container.appVisible.value = true
        container.wake.foreground.value = true
        container.player.connect()
    }

    override fun onStop() {
        super.onStop()
        container.appVisible.value = false
        container.wake.foreground.value = false
        if (!isChangingConfigurations) container.player.disconnect()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (actions != null) handleIntent(intent) else pendingIntent = intent
    }

    private fun handleIntent(intent: Intent) {
        val a = actions ?: return
        if (intent.getBooleanExtra(EXTRA_OPEN_PLAYER, false)) {
            a.playerExpanded = true
            return
        }
        if (intent.getBooleanExtra(EXTRA_ASSISTANT, false) || intent.action == ACTION_ASSISTANT) {
            intent.removeExtra(EXTRA_ASSISTANT)
            intent.action = null
            a.assistant = true
            return
        }
        if (intent.getBooleanExtra(EXTRA_OPEN_LYRICS, false)) {
            a.playerExpanded = true
            a.showLyrics = true
            return
        }
        intent.getStringExtra(EXTRA_PLAY_SOURCE)?.let { source ->
            intent.removeExtra(EXTRA_PLAY_SOURCE)
            playSource(a, source)
            return
        }
        if (intent.getBooleanExtra(EXTRA_RECOGNIZE, false) || intent.action == ACTION_RECOGNIZE) {
            intent.action = null
            a.navigate(com.freease.music.ui.navigation.Routes.recognize(auto = true))
            return
        }
        intent.getStringExtra(EXTRA_OPEN_ROUTE)?.let { route ->
            intent.removeExtra(EXTRA_OPEN_ROUTE)
            a.navigate(route)
            return
        }
        if (intent.getBooleanExtra(EXTRA_OPEN_ALARMS, false)) {
            a.navigate(com.freease.music.ui.navigation.Routes.ALARMS)
            return
        }
        if (intent.action == android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH) {
            val query = intent.getStringExtra(android.app.SearchManager.QUERY).orEmpty()
            intent.action = null // jangan diputar ulang saat layar diputar
            lifecycleScope.launch {
                val songs = container.voiceQueue(query)
                if (songs.isEmpty()) a.toast("Tidak menemukan \"$query\"") else {
                    a.player.play(songs, from = if (query.isBlank()) "Lagu yang Disukai" else "Perintah suara: $query")
                    a.playerExpanded = true
                }
            }
            return
        }
        mediaUris(intent).takeIf { it.isNotEmpty() }?.let { uris ->
            intent.action = null // jangan diputar ulang saat layar diputar
            openMedia(a, uris)
            return
        }
        val text = when (intent.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        } ?: return
        when {
            YouTubeRepository.isYouTubeUrl(text) -> a.handleLink(text)
            com.freease.music.data.importer.SpotifyReader.isSpotifyLink(text) ->
                a.navigate(com.freease.music.ui.navigation.Routes.import(text.trim()))
        }
    }

    /** Berkas audio/video yang dibuka ("Buka dengan Freease") atau dibagikan ke Freease. */
    private fun mediaUris(intent: Intent): List<android.net.Uri> {
        val type = intent.type ?: intent.data?.let { contentResolver.getType(it) }
        return when (intent.action) {
            Intent.ACTION_VIEW -> {
                val u = intent.data ?: return emptyList()
                if (u.scheme != "content" && u.scheme != "file") return emptyList()
                if (com.freease.music.data.local.ExternalMedia.isPlayableType(type ?: contentResolver.getType(u))) listOf(u) else emptyList()
            }
            Intent.ACTION_SEND -> {
                if (!com.freease.music.data.local.ExternalMedia.isPlayableType(type)) return emptyList()
                listOfNotNull(androidx.core.content.IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, android.net.Uri::class.java))
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                if (type != null && type != "*/*" && !com.freease.music.data.local.ExternalMedia.isPlayableType(type)) return emptyList()
                androidx.core.content.IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, android.net.Uri::class.java).orEmpty()
            }
            else -> emptyList()
        }
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun openMedia(a: com.freease.music.ui.navigation.AppActions, uris: List<android.net.Uri>) {
        lifecycleScope.launch {
            val songs = uris.take(500).map { u ->
                com.freease.music.data.local.ExternalMedia.keepAccess(this@MainActivity, u)
                com.freease.music.data.local.ExternalMedia.describe(this@MainActivity, u)
            }
            a.player.play(songs, from = if (songs.size == 1) "Berkas di HP" else "${songs.size} berkas di HP")
            a.playerExpanded = true
        }
    }

    /** Pintasan widget "Lanjutkan": putar sumber lagu lalu buka player. */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun playSource(a: com.freease.music.ui.navigation.AppActions, source: String) {
        if (source == com.freease.music.widget.ContinueWidget.SOURCE_RESUME) {
            val c = a.player.controller.value
            if (c != null && c.mediaItemCount > 0) {
                c.play()
            } else {
                startService(
                    Intent(this, com.freease.music.playback.PlaybackService::class.java)
                        .setAction(com.freease.music.playback.PlaybackService.ACTION_WIDGET)
                        .putExtra(com.freease.music.playback.PlaybackService.EXTRA_CMD, "toggle"),
                )
            }
            a.playerExpanded = true
            return
        }
        lifecycleScope.launch {
            val (songs, label) = if (source.startsWith("mix:")) {
                container.dailyMix.ensureFresh()
                val mix = container.dailyMix.mixes.value.getOrNull(source.removePrefix("mix:").toIntOrNull() ?: 0)
                (mix?.songs.orEmpty()) to (mix?.title ?: "Daily Mix")
            } else {
                com.freease.music.playback.LibraryTree(container).songsOf(source) to when (source) {
                    com.freease.music.playback.LibraryTree.LIKED -> "Lagu yang Disukai"
                    com.freease.music.playback.LibraryTree.RECENT -> "Baru diputar"
                    com.freease.music.playback.LibraryTree.DOWNLOADS -> "Unduhan"
                    else -> "Playlist"
                }
            }
            if (songs.isEmpty()) {
                a.toast("Belum ada lagu di $label")
                return@launch
            }
            a.player.play(songs, shuffle = source == com.freease.music.playback.LibraryTree.LIKED, from = label)
            a.playerExpanded = true
        }
    }

    companion object {
        const val EXTRA_ASSISTANT = "assistant"
        const val ACTION_ASSISTANT = "com.freease.music.ASSISTANT"
        const val ACTION_RECOGNIZE = "com.freease.music.RECOGNIZE"
        const val EXTRA_OPEN_LYRICS = "open_lyrics"
        const val EXTRA_PLAY_SOURCE = "play_source"
        const val EXTRA_OPEN_PLAYER = "open_player"
        const val EXTRA_OPEN_ALARMS = "open_alarms"
        const val EXTRA_OPEN_ROUTE = "open_route"
        const val EXTRA_RECOGNIZE = "recognize"
    }
}
