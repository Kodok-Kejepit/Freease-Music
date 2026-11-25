package com.freease.music.stream.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CollectionsBookmark
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.freease.music.stream.data.Anime
import com.freease.music.stream.data.Manga
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.navigation.LocalBottomInset
import com.freease.music.ui.theme.Freease

private val TABS = listOf("anime" to "Anime", "donghua" to "Donghua", "komik" to "Komik")

/** Beranda Freease Stream: tiga bagian (Anime, Donghua, Komik), "Lanjutkan" di atas, lalu rak-rak tiap sumber. */
@OptIn(UnstableApi::class)
@Composable
fun StreamHomeScreen(initialTab: String) {
    val actions = LocalActions.current
    var tab by rememberSaveable(initialTab) { mutableStateOf(initialTab.takeIf { t -> TABS.any { it.first == t } } ?: "anime") }
    val accent = Freease.accent
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
        item {
            Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(accent.secondary.copy(alpha = 0.28f), Color.Transparent)))) {
                Column(Modifier.statusBarsPadding().padding(top = 12.dp)) {
                    Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Freease Stream", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                            Text("Anime, donghua, dan komik tanpa iklan", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                        }
                        IconButton(onClick = { actions.navigate(StreamRoutes.SEARCH) }) { Icon(Icons.Rounded.Search, "Cari") }
                        IconButton(onClick = { actions.navigate(StreamRoutes.schedule(tab == "donghua")) }) { Icon(Icons.Rounded.CalendarMonth, "Jadwal rilis") }
                        IconButton(onClick = { actions.navigate(StreamRoutes.LIBRARY) }) { Icon(Icons.Rounded.CollectionsBookmark, "Koleksi") }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TABS.forEach { (k, label) ->
                            val on = tab == k
                            Text(
                                label, fontWeight = FontWeight.Bold, color = if (on) Color.White else Freease.colors.muted,
                                modifier = Modifier.clip(RoundedCornerShape(50))
                                    .background(if (on) Brush.linearGradient(listOf(accent.primary, accent.secondary)) else Brush.linearGradient(listOf(Freease.colors.card, Freease.colors.card)))
                                    .clickable { tab = k }.padding(horizontal = 18.dp, vertical = 9.dp),
                            )
                        }
                    }
                }
            }
        }
        item { ContinueShelf(tab) }
        when (tab) {
            "anime" -> item { AnimeTab() }
            "donghua" -> item { DonghuaTab() }
            else -> item { KomikTab() }
        }
        item {
            Text(
                "Konten diambil dari sumber publik pihak ketiga. Freease tidak menyimpan video atau gambar.",
                style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, modifier = Modifier.padding(24.dp),
            )
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun ContinueShelf(tab: String) {
    val actions = LocalActions.current
    val store = streamContainer().streamStore
    val data by store.data.collectAsState()
    val items = data.recent.filter { if (tab == "komik") it.kind == "manga" else it.kind == "anime" }.take(16)
    Shelf("Lanjutkan", items, onMore = { actions.navigate(StreamRoutes.LIBRARY) }, key = { it.key }) { s ->
        Box {
            PosterCard(
                s.title, s.cover, width = 120.dp, sub = s.itemLabel, manga = s.kind == "manga", progress = s.progress,
                onClick = {
                    val item = s.itemId
                    when {
                        item == null -> actions.navigate(if (s.kind == "manga") StreamRoutes.manga(s.id) else StreamRoutes.anime(s.id))
                        s.kind == "manga" -> actions.navigate(StreamRoutes.read(s.id, item))
                        else -> actions.navigate(StreamRoutes.watch(item))
                    }
                },
            )
            IconButton(onClick = { store.forget(s.kind, s.id) }, modifier = Modifier.align(Alignment.TopEnd).size(30.dp)) {
                Icon(Icons.Rounded.Close, "Hapus dari Lanjutkan", tint = Color.White, modifier = Modifier.size(16.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f)))
            }
        }
    }
}

private fun animeSub(a: Anime) = listOfNotNull(a.type, a.year?.toString(), a.status).joinToString(" • ")

@OptIn(UnstableApi::class)
@Composable
private fun AnimeTab() {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    val (load, retry) = rememberLoad("animeHome") { repo.animeHome() }
    val h = load.data
    if (h == null) { if (load.error != null) ErrorBox(load.error, retry) else LoadingBox(); return }
    Column {
        h.ak.featured.ifEmpty { h.ak.trending.take(6) }.firstOrNull()?.let { Hero(it, "Sorotan") }
        Shelf("Episode terbaru", h.ak.latest, onMore = { actions.navigate(StreamRoutes.browse(order = "latest")) }, key = { it.episodeId ?: it.id }) { a ->
            PosterCard(a.title, a.cover, { a.episodeId?.let { actions.navigate(StreamRoutes.watch(it)) } ?: actions.navigate(StreamRoutes.anime(a.id)) },
                badge = timeAgoIso(a.note), badgeEnd = a.episode?.let { "Ep $it" })
        }
        Shelf("Rilis terbaru Otakudesu", h.odLatest, onMore = { actions.navigate(StreamRoutes.browse(src = "od")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id, a.episode.orEmpty())) }, sub = a.note, badgeEnd = a.episode?.let { "Ep $it" })
        }
        Shelf("Lagi rame hari ini", h.ak.trending, onMore = { actions.navigate(StreamRoutes.browse()) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a), badge = a.type)
        }
        Shelf("Populer minggu ini", h.ak.weekly.withIndex().toList(), onMore = { actions.navigate(StreamRoutes.browse()) }, key = { it.value.id }) { (i, a) ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a), badge = "#${i + 1}")
        }
        Shelf("Sedang tayang", h.ak.ongoing, onMore = { actions.navigate(StreamRoutes.browse(status = "ongoing")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a), badge = a.type)
        }
        Shelf("Film anime", h.ak.movies, onMore = null, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a), badge = "Movie")
        }
        Shelf("Populer sepanjang masa", h.ak.allTime, onMore = null, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a), badgeEnd = a.rating?.let { "Skor $it" })
        }
        Shelf("Sudah tamat", h.ak.completed, onMore = { actions.navigate(StreamRoutes.browse(status = "completed")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a))
        }
        Shelf("Baru tamat di Otakudesu", h.odCompleted, onMore = { actions.navigate(StreamRoutes.browse(src = "od", status = "completed")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = a.episode?.let { "$it episode" }, badgeEnd = a.rating?.let { "Skor $it" })
        }
        BrowseButton("Jelajah semua anime") { actions.navigate(StreamRoutes.browse()) }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun DonghuaTab() {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    val (load, retry) = rememberLoad("donghuaHome") { repo.donghuaHome() }
    val h = load.data
    if (h == null) { if (load.error != null) ErrorBox(load.error, retry) else LoadingBox(); return }
    Column {
        h.latest.firstOrNull()?.let { top -> Hero(top, "Baru rilis", play = top.episodeId?.let { { actions.navigate(StreamRoutes.watch(it)) } }) }
        Shelf("Rilisan terbaru", h.latest, onMore = { actions.navigate(StreamRoutes.browse(src = "ac", order = "latest")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { a.episodeId?.let { actions.navigate(StreamRoutes.watch(it)) } }, sub = "Donghua", badgeEnd = a.episode?.let { "Ep $it" })
        }
        Shelf("Rekomendasi", h.recommended, onMore = null, key = { it.id }) { a -> PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = a.status) }
        Shelf("Paling populer", h.popular.withIndex().toList(), onMore = { actions.navigate(StreamRoutes.browse(src = "ac", order = "popular")) }, key = { it.value.id }) { (i, a) ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = a.status, badge = "#${i + 1}")
        }
        Shelf("Sedang tayang", h.ongoing, onMore = { actions.navigate(StreamRoutes.browse(src = "ac", status = "ongoing")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = a.episode?.let { "Ep $it" } ?: a.status)
        }
        Shelf("Sudah tamat", h.completed, onMore = { actions.navigate(StreamRoutes.browse(src = "ac", status = "completed")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = a.status)
        }
        Shelf("Donghua di Animekompi", h.animekompi, onMore = { actions.navigate(StreamRoutes.browse(order = "latest", genre = "donghua")) }, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, sub = animeSub(a), badgeEnd = a.rating?.let { "Skor $it" })
        }
        BrowseButton("Jelajah semua donghua") { actions.navigate(StreamRoutes.browse(src = "ac")) }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun KomikTab() {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    val (load, retry) = rememberLoad("mangaHome") { repo.mangaHome() }
    val h = load.data
    if (h == null) { if (load.error != null) ErrorBox(load.error, retry) else LoadingBox(); return }
    @Composable fun row(title: String, list: List<Manga>, src: String?, badge: (Manga) -> String? = { it.type }) =
        Shelf(title, list, onMore = src?.let { { actions.navigate(StreamRoutes.mangaBrowse(it)) } }, key = { it.id }) { m ->
            PosterCard(m.title, m.cover, { actions.navigate(StreamRoutes.manga(m.id)) }, manga = true, sub = m.source, badge = badge(m), badgeEnd = m.latest?.let { "Ch $it" })
        }
    Column {
        row("Komik populer", h.popular, "sh")
        row("Komik baru update", h.latest, "km")
        row("Manhwa pilihan", h.manhwa, "km") { "Manhwa" }
        row("Tren WEBTOON", h.webtoons, "wt") { null }
        row("Baru di Komikindo", h.indo, "ki")
        row("Manga bahasa Inggris", h.english, "kk") { null }
        BrowseButton("Jelajah semua komik") { actions.navigate(StreamRoutes.mangaBrowse()) }
    }
}

@Composable
private fun Hero(a: Anime, kicker: String, play: (() -> Unit)? = null) {
    val actions = LocalActions.current
    Row(
        Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Freease.colors.card).clickable { actions.navigate(StreamRoutes.anime(a.id)) }.padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(a.cover, Modifier.width(96.dp).height(144.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(kicker.uppercase(), style = MaterialTheme.typography.labelSmall, color = Freease.accent.primary, fontWeight = FontWeight.Bold)
            Text(a.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(a.type, a.status, a.rating?.let { "Skor $it" }, a.episode?.let { "Episode $it" }).joinToString(" • "),
                style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
            a.synopsis?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp)) }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = play ?: { actions.navigate(StreamRoutes.anime(a.id, play = true)) },
                colors = ButtonDefaults.buttonColors(containerColor = Freease.accent.primary),
            ) { Icon(Icons.Rounded.PlayArrow, null); Spacer(Modifier.width(4.dp)); Text("Tonton") }
        }
    }
}

@Composable
private fun BrowseButton(label: String, onClick: () -> Unit) {
    Row(
        Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Freease.colors.card).clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) { Icon(Icons.Rounded.Explore, null, tint = Freease.accent.primary); Spacer(Modifier.width(8.dp)); Text(label, fontWeight = FontWeight.Bold) }
}

/** Tanggal ISO dari Animekompi → "3 jam lalu". */
fun timeAgoIso(iso: String?): String? = iso?.let { t ->
    runCatching { java.time.OffsetDateTime.parse(t).toInstant().toEpochMilli() }.recoverCatching { java.time.Instant.parse(t).toEpochMilli() }
        .recoverCatching { java.time.LocalDateTime.parse(t.replace(' ', 'T')).atZone(java.time.ZoneId.of("Asia/Jakarta")).toInstant().toEpochMilli() }
        .getOrNull()?.let(::timeAgo)?.ifEmpty { null }
}
