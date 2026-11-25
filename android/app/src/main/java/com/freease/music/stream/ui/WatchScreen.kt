package com.freease.music.stream.ui

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.freease.music.stream.data.EpisodeData
import com.freease.music.stream.data.Resolvers
import com.freease.music.stream.data.Saved
import com.freease.music.stream.data.UA_DESKTOP
import com.freease.music.stream.data.VideoSource
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.navigation.LocalBottomInset
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.delay

private const val PREF = "stream_player"

/** Tonton episode: pemutar Freease (ExoPlayer) untuk berkas langsung, pindah server otomatis kalau gagal, posisi tersimpan. */
@OptIn(UnstableApi::class, ExperimentalLayoutApi::class)
@Composable
fun WatchScreen(id: String) {
    val actions = LocalActions.current
    val c = streamContainer()
    val (load, retry) = rememberLoad(id) { c.stream.episode(id) }
    val ep = load.data
    val store by c.streamStore.data.collectAsState()
    var full by remember { mutableStateOf(false) }
    if (ep == null) {
        Column(Modifier.fillMaxSize()) {
            StreamTopBar("")
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black), contentAlignment = Alignment.Center) {
                if (load.error != null) ErrorBox(load.error, retry) else LoadingBox(Modifier.fillMaxSize())
            }
        }
        return
    }
    val anime = ep.anime
    val epList = remember(ep) { ep.episodes.sortedBy { it.number.toDoubleOrNull() ?: 0.0 } }

    Column(Modifier.fillMaxSize()) {
    Box(if (full) Modifier.fillMaxSize() else Modifier.statusBarsPadding()) {
        Player(ep, full, onFull = { full = it })
        if (!full) IconButton(onClick = { actions.nav.popBackStack() }, modifier = Modifier.padding(4.dp)) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Kembali", tint = Color.White) }
    }
    if (!full) LazyVerticalGrid(GridCells.Adaptive(64.dp), Modifier.weight(1f),
        contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        anime?.let { Cover(it.cover, Modifier.width(54.dp).height(80.dp).clickable { actions.navigate(StreamRoutes.anime(it.id)) }, shape = RoundedCornerShape(8.dp)) }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(anime?.title ?: ep.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clickable { anime?.let { actions.navigate(StreamRoutes.anime(it.id)) } })
                            Text(listOfNotNull("Episode ${ep.number}", anime?.status, "${ep.sources.size} server".takeIf { ep.sources.isNotEmpty() }, anime?.source).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                        }
                        anime?.let { FavButton(Saved("anime", it.id, it.title, it.cover, listOfNotNull(it.type, it.year?.toString()).joinToString(" • "))) }
                    }
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { ep.prev?.let { actions.nav.navigate(StreamRoutes.watch(it.id)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } } } },
                            enabled = ep.prev != null, modifier = Modifier.weight(1f)) { Icon(Icons.Rounded.SkipPrevious, null); Text("Sebelumnya") }
                        Button(onClick = { ep.next?.let { actions.nav.navigate(StreamRoutes.watch(it.id)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } } } },
                            enabled = ep.next != null, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Freease.accent.primary)) { Text("Berikutnya"); Icon(Icons.Rounded.SkipNext, null) }
                    }
                    anime?.let { AltSources(it, null, ep.number, if (ep.sources.isEmpty()) "Coba episode ini di sumber lain" else "Tonton dari sumber lain") }
                    Text("Episode (${epList.size})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
                }
            }
        }
        items(epList, key = { it.id }) { e ->
            val s = store.seen[e.id]
            val cur = e.id == ep.id
            Box(Modifier.padding(horizontal = 4.dp).height(46.dp).clip(RoundedCornerShape(10.dp))
                .background(if (cur) Brush.linearGradient(listOf(Freease.accent.primary, Freease.accent.secondary)) else Brush.linearGradient(listOf(Freease.colors.card, Freease.colors.card)))
                .clickable { if (!cur) actions.nav.navigate(StreamRoutes.watch(e.id)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } } },
                contentAlignment = Alignment.Center) {
                Text(e.number.ifEmpty { "?" }, fontWeight = FontWeight.Bold, color = if (s != null && !cur) Freease.colors.muted else Color.White)
                if (s != null && !cur && s.dur > 0) Box(Modifier.align(Alignment.BottomStart).fillMaxWidth((s.pos.toFloat() / s.dur).coerceIn(0f, 1f)).height(3.dp).background(Freease.accent.primary))
            }
        }
    }
    }
}

@OptIn(UnstableApi::class, ExperimentalLayoutApi::class)
@Composable
private fun Player(ep: EpisodeData, full: Boolean, onFull: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val actions = LocalActions.current
    val c = streamContainer()
    val prefs = remember { ctx.getSharedPreferences(PREF, 0) }
    val list = remember(ep) {
        val want = prefs.getString("quality", "").orEmpty()
        ep.sources.sortedWith(compareBy<VideoSource> { it.embed }.thenByDescending { it.quality == want }.thenByDescending { it.height })
    }
    var idx by remember(ep.id) { mutableIntStateOf(0) }
    var failed by remember(ep.id) { mutableStateOf(false) }
    var countdown by remember(ep.id) { mutableStateOf<Int?>(null) }
    val src = list.getOrNull(idx)
    val anime = ep.anime

    val player = remember { ExoPlayer.Builder(ctx).build() }
    DisposableEffect(Unit) { onDispose { player.release() } }

    fun save() {
        val a = anime ?: return
        val d = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: return
        if (player.currentPosition < 3000) return
        c.streamStore.saveProgress(Saved("anime", a.id, a.title, a.cover, listOfNotNull(a.type).joinToString(), ep.id, "Episode ${ep.number}", player.currentPosition, d))
    }

    // Sumber berganti → muat ulang; lanjut dari posisi terakhir episode ini.
    LaunchedEffect(src) {
        val s = src ?: return@LaunchedEffect
        if (s.embed) { player.stop(); anime?.let { c.streamStore.saveProgress(Saved("anime", it.id, it.title, it.cover, it.type, ep.id, "Episode ${ep.number}")) }; return@LaunchedEffect }
        val headers = mapOf("User-Agent" to UA_DESKTOP) + s.headers
        val factory = OkHttpDataSource.Factory(c.stream.http.client).setDefaultRequestProperties(headers)
        val resume = if (player.currentMediaItem != null && player.currentPosition > 5000) player.currentPosition else
            c.streamStore.seen(ep.id)?.takeIf { it.pos > 15_000 && (it.dur == 0L || it.pos < it.dur - 30_000) }?.pos ?: 0L
        player.setMediaSource(ProgressiveMediaSource.Factory(factory).createMediaSource(MediaItem.fromUri(Uri.parse(s.url))), resume)
        player.prepare()
        player.playWhenReady = true
        c.player.pause()
    }

    DisposableEffect(player, list, idx) {
        val l = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                if (idx + 1 < list.size) { actions.toast("${src?.label} ${src?.quality} gagal, pindah ke ${list[idx + 1].label} ${list[idx + 1].quality}"); idx++ }
                else failed = true
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) { save(); if (ep.next != null && prefs.getBoolean("autonext", true)) countdown = 8 }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (!isPlaying) save() else c.player.pause() }
        }
        player.addListener(l)
        onDispose { player.removeListener(l); save() }
    }
    LaunchedEffect(Unit) { while (true) { delay(5000); if (player.isPlaying) save() } }
    LaunchedEffect(countdown) {
        val n = countdown ?: return@LaunchedEffect
        if (n <= 0) { countdown = null; ep.next?.let { actions.nav.navigate(StreamRoutes.watch(it.id)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } } } }
        else { delay(1000); countdown = n - 1 }
    }

    // Layar penuh: sembunyikan bilah sistem dan putar ke lanskap.
    val activity = androidx.activity.compose.LocalActivity.current
    BackHandler(enabled = full) { onFull(false) }
    DisposableEffect(full) {
        val w = activity?.window
        if (full && w != null) {
            val ins = WindowCompat.getInsetsController(w, w.decorView)
            ins.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ins.hide(WindowInsetsCompat.Type.systemBars())
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            c.videoOnScreen.value = true
        }
        onDispose {
            if (full && w != null) {
                WindowCompat.getInsetsController(w, w.decorView).show(WindowInsetsCompat.Type.systemBars())
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                c.videoOnScreen.value = false
            }
        }
    }

    Column {
        Box(if (full) Modifier.fillMaxSize().background(Color.Black) else Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black)) {
            when {
                src == null -> Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.Warning, null, tint = Color.White); Spacer(Modifier.height(8.dp))
                    Text("Belum ada server yang bisa diputar tanpa iklan untuk episode ini.", color = Color.White, textAlign = TextAlign.Center)
                }
                src.embed -> EmbedFrame(src)
                else -> AndroidView(factory = { ctx2 ->
                    PlayerView(ctx2).apply {
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        this.player = player
                        setShowNextButton(false); setShowPreviousButton(false)
                        setFullscreenButtonClickListener { onFull(it) }
                        keepScreenOn = true
                    }
                }, update = { it.setFullscreenButtonState(full) }, modifier = Modifier.fillMaxSize())
            }
            if (failed) Column(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.85f)).padding(20.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Semua server gagal memutar episode ini.", color = Color.White, textAlign = TextAlign.Center)
                Button(onClick = { failed = false; idx = 0 }) { Text("Coba lagi") }
            }
            countdown?.let { n ->
                Row(Modifier.align(Alignment.BottomEnd).padding(12.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.8f)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Episode ${ep.next?.number} dalam $n", color = Color.White); Spacer(Modifier.width(8.dp))
                    Text("Batal", color = Freease.accent.primary, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { countdown = null })
                }
            }
        }
        if (!full && list.isNotEmpty()) {
            FlowRow(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                list.forEachIndexed { i, s ->
                    val on = i == idx
                    Text("${s.label} · ${s.quality}" + if (s.embed) " · pembatas" else "", style = MaterialTheme.typography.labelMedium, color = if (on) Color.White else MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.clip(RoundedCornerShape(50))
                            .background(if (on) Brush.linearGradient(listOf(Freease.accent.primary, Freease.accent.secondary)) else Brush.linearGradient(listOf(Freease.colors.card, Freease.colors.card)))
                            .clickable { if (!s.embed) prefs.edit().putString("quality", s.quality).apply(); failed = false; idx = i }.padding(horizontal = 10.dp, vertical = 6.dp))
                }
            }
        }
    }
}

/**
 * Pemutar situs lain sebagai cadangan, dikunci: tidak boleh membuka jendela baru, pindah ke situs lain, mengunduh,
 * atau memuat domain iklan yang dikenal. Hanya host yang ada di daftar [Resolvers.EMBED_HOSTS] yang dimuat.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun EmbedFrame(src: VideoSource) {
    AndroidView(factory = { ctx ->
        WebView(ctx).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.userAgentString = UA_DESKTOP
            setBackgroundColor(android.graphics.Color.BLACK)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val host = request.url.host.orEmpty()
                    return !(request.isForMainFrame && Resolvers.embedAllowed(host))
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val host = request.url.host.orEmpty()
                    return if (AD_HOSTS.any { host == it || host.endsWith(".$it") }) WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0))) else null
                }
            }
            loadUrl(src.url)
        }
    }, update = { if (it.url != src.url) it.loadUrl(src.url) }, onRelease = { it.destroy() }, modifier = Modifier.fillMaxSize())
}

private val AD_HOSTS = listOf(
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com", "googletagmanager.com", "adservice.google.com",
    "dtscout.com", "crwdcntrl.net", "popads.net", "popcash.net", "propellerads.com", "adsterra.com", "exoclick.com", "juicyads.com",
    "acscdn.com", "aclib.js", "onclickads.net", "hilltopads.net", "a-ads.com", "adcash.com", "mgid.com", "taboola.com", "outbrain.com",
)
