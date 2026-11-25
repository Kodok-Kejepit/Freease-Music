package com.freease.music.stream.ui

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SwapVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.freease.music.stream.data.Anime
import com.freease.music.stream.data.Genre
import com.freease.music.stream.data.Saved
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.navigation.LocalBottomInset
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.launch

/** Kepala halaman Stream: tombol kembali + judul. */
@Composable
fun StreamTopBar(title: String, actionsSlot: @Composable () -> Unit = {}) {
    val actions = LocalActions.current
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 4.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { actions.nav.popBackStack() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Kembali") }
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        actionsSlot()
    }
}

// ---------------------------------------------------------------- jelajah

private val SOURCES = listOf("" to "Animekompi", "od" to "Otakudesu", "ac" to "Anichin · Donghua")
private val ORDERS = listOf("popular" to "Populer", "latest" to "Terbaru", "rating" to "Rating", "title" to "A–Z")
private val TYPES = listOf("" to "Semua", "tv" to "TV", "movie" to "Movie", "ona" to "ONA", "ova" to "OVA")
private val STATUS = listOf("" to "Semua status", "ongoing" to "Sedang tayang", "completed" to "Tamat")

@OptIn(UnstableApi::class, ExperimentalLayoutApi::class)
@Composable
fun AnimeBrowseScreen(src0: String, order0: String, status0: String, genre0: String) {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    var src by rememberSaveable { mutableStateOf(src0) }
    var order by rememberSaveable { mutableStateOf(order0.ifEmpty { "popular" }) }
    var status by rememberSaveable { mutableStateOf(status0) }
    var genre by rememberSaveable { mutableStateOf(genre0) }
    var type by rememberSaveable { mutableStateOf("") }
    var showGenres by remember { mutableStateOf(genre0.isNotEmpty()) }
    val items = remember(src, order, status, genre, type) { mutableStateListOf<Anime>() }
    var page by remember(src, order, status, genre, type) { mutableIntStateOf(1) }
    var hasMore by remember(src, order, status, genre, type) { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val (genres, _) = rememberLoad("g", src) { repo.genres(src) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    fun loadMore() {
        if (loading || !hasMore) return
        loading = true; error = null
        scope.launch {
            runCatching { repo.browse(src, order, page, genre.ifEmpty { null }, type.ifEmpty { null }, status.ifEmpty { null }) }
                .onSuccess { r -> items.addAll(r.items.filter { n -> items.none { it.id == n.id } }); hasMore = r.hasMore && r.items.isNotEmpty(); page++ }
                .onFailure { error = it.message ?: "Gagal memuat" }
            loading = false
        }
    }
    LaunchedEffect(src, order, status, genre, type) { loadMore() }

    LazyVerticalGrid(GridCells.Adaptive(112.dp), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = LocalBottomInset.current + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                StreamTopBar(if (src == "ac") "Donghua" else "Anime") {
                    TextButton(onClick = { showGenres = !showGenres }) { Text(if (genre.isNotEmpty()) "Genre: ${genres.data?.firstOrNull { it.id == genre }?.name ?: genre}" else "Genre") }
                }
                ChipRow(SOURCES, src, { src = it; genre = ""; status = ""; type = ""; order = "popular" })
                Spacer(Modifier.height(6.dp))
                if (src != "od") ChipRow(ORDERS, order, { order = it })
                Spacer(Modifier.height(6.dp))
                ChipRow(if (src == "od") STATUS.drop(1) else STATUS, status.ifEmpty { if (src == "od") "ongoing" else "" }, { status = it; if (src == "od") genre = "" })
                if (src == "") { Spacer(Modifier.height(6.dp)); ChipRow(TYPES, type, { type = it }) }
                if (showGenres) GenreFlow(genres.data.orEmpty(), genre) { genre = it }
                Spacer(Modifier.height(10.dp))
            }
        }
        items(items, key = { it.id }) { a ->
            PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id, a.episode.orEmpty().takeIf { src == "od" && status != "completed" }.orEmpty())) }, width = 200.dp,
                sub = listOfNotNull(a.type, a.year?.toString(), a.note).joinToString(" • ").ifEmpty { a.source },
                badge = a.episode?.let { "Ep $it" } ?: a.status?.takeIf { it == "Ongoing" }, badgeEnd = a.rating?.let { "Skor $it" })
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            when {
                loading -> LoadingBox(Modifier.fillMaxWidth().height(80.dp))
                error != null -> ErrorBox(error!!, { loadMore() })
                items.isEmpty() -> EmptyBox("Tidak ada judul", "Coba ubah filter.")
                hasMore -> OutlinedButton(onClick = { loadMore() }, modifier = Modifier.fillMaxWidth()) { Text("Muat lebih banyak") }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GenreFlow(list: List<Genre>, selected: String, onPick: (String) -> Unit) {
    FlowRow(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        (listOf(Genre("", "Semua genre")) + list).forEach { g ->
            val on = g.id == selected
            Text(g.name, style = MaterialTheme.typography.labelLarge, color = if (on) Color.Black else MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Color.White else Freease.colors.card).clickable { onPick(g.id) }.padding(horizontal = 12.dp, vertical = 6.dp))
        }
    }
}

// ---------------------------------------------------------------- detail

@OptIn(UnstableApi::class, ExperimentalLayoutApi::class)
@Composable
fun AnimeDetailScreen(id: String, ep: String, play: Boolean) {
    val actions = LocalActions.current
    val c = streamContainer()
    val (load, retry) = rememberLoad(id) { c.stream.detail(id) }
    val store by c.streamStore.data.collectAsState()
    var newest by rememberSaveable { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf("") }
    var more by remember { mutableStateOf(false) }
    val d = load.data
    LaunchedEffect(d) {
        if (d == null) return@LaunchedEffect
        val hit = ep.takeIf { it.isNotEmpty() }?.let { n -> d.episodes.firstOrNull { it.number == n } }
        val prog = c.streamStore.progressOf("anime", d.anime.id)
        when {
            hit != null -> actions.nav.navigate(StreamRoutes.watch(hit.id)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } }
            play -> (prog?.itemId ?: d.episodes.lastOrNull()?.id)?.let { actions.nav.navigate(StreamRoutes.watch(it)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } } }
        }
    }
    if (d == null) {
        Column(Modifier.fillMaxSize()) { StreamTopBar(""); if (load.error != null) ErrorBox(load.error, retry) else LoadingBox() }
        return
    }
    val a = d.anime
    val prog = store.recent.firstOrNull { it.kind == "anime" && it.id == a.id }
    val first = d.episodes.lastOrNull()
    val eps = d.episodes.filter { filter.isBlank() || filter.trim() in it.number || it.title.contains(filter.trim(), true) }.let { if (newest) it else it.reversed() }
    val saved = Saved("anime", a.id, a.title, a.cover, listOfNotNull(a.type, a.year?.toString()).joinToString(" • "))

    LazyVerticalGrid(GridCells.Adaptive(64.dp), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = LocalBottomInset.current + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                StreamTopBar("") { FavButton(saved) }
                Row {
                    Cover(a.cover, Modifier.width(120.dp).height(180.dp), shape = RoundedCornerShape(14.dp))
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (a.type == "Donghua") "DONGHUA" else "ANIME" + (a.type?.let { " · $it" } ?: ""), style = MaterialTheme.typography.labelSmall, color = Freease.accent.primary, fontWeight = FontWeight.Bold)
                        Text(a.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        d.altTitles?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                        Spacer(Modifier.height(6.dp))
                        Text(listOfNotNull(a.status, a.rating?.let { "Skor $it" }, a.year?.toString(), a.studio, "${d.episodes.size} episode", a.source).joinToString(" • "),
                            style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                    }
                }
                Spacer(Modifier.height(14.dp))
                val target = prog?.itemId?.let { it to "Lanjutkan ${prog.itemLabel.orEmpty()}" } ?: first?.let { it.id to "Tonton Episode ${it.number}" }
                if (target != null) Button(onClick = { actions.navigate(StreamRoutes.watch(target.first)) }, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Freease.accent.primary)) { Icon(Icons.Rounded.PlayArrow, null); Spacer(Modifier.width(6.dp)); Text(target.second) }
                if (a.genres.isNotEmpty()) FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val src = when { a.source == "Otakudesu" -> "od"; a.source == "Anichin" -> "ac"; else -> "" }
                    a.genres.forEach { g ->
                        Text(g, style = MaterialTheme.typography.labelMedium, modifier = Modifier.clip(RoundedCornerShape(50)).background(Freease.colors.card)
                            .clickable { actions.navigate(StreamRoutes.browse(src = src, genre = g.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-'))) }.padding(horizontal = 10.dp, vertical = 5.dp))
                    }
                }
                a.synopsis?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, maxLines = if (more) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 12.dp).clickable { more = !more })
                }
                AltSources(a, d.altTitles, null)
                Row(Modifier.padding(top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Episode", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = { newest = !newest }) { Icon(Icons.Rounded.SwapVert, null); Text(if (newest) "Terbaru dulu" else "Terlama dulu") }
                }
                if (d.episodes.size > 12) OutlinedTextField(filter, { filter = it }, Modifier.fillMaxWidth(), placeholder = { Text("Cari nomor episode") }, singleLine = true)
                if (d.episodes.isEmpty()) EmptyBox("Belum ada episode", "Sumber belum mengunggah episode untuk judul ini.")
            }
        }
        items(eps, key = { it.id }) { e ->
            val s = store.seen[e.id]
            val cur = prog?.itemId == e.id
            Box(Modifier.height(48.dp).clip(RoundedCornerShape(10.dp))
                .background(if (cur) Brush.linearGradient(listOf(Freease.accent.primary, Freease.accent.secondary)) else Brush.linearGradient(listOf(Freease.colors.card, Freease.colors.card)))
                .clickable { actions.navigate(StreamRoutes.watch(e.id)) }, contentAlignment = Alignment.Center) {
                Text(e.number.ifEmpty { "?" }, fontWeight = FontWeight.Bold, color = if (s != null && !cur) Freease.colors.muted else Color.White)
                if (s != null && !cur && s.dur > 0) Box(Modifier.align(Alignment.BottomStart).fillMaxWidth((s.pos.toFloat() / s.dur).coerceIn(0f, 1f)).height(3.dp).background(Freease.accent.primary))
            }
        }
    }
}

/** Judul yang sama di sumber anime lain; [epNumber] membawa langsung ke episode bernomor sama. */
@OptIn(UnstableApi::class, ExperimentalLayoutApi::class)
@Composable
fun AltSources(a: Anime, alt: String?, epNumber: String?, title: String = "Juga tersedia di") {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    val (load, _) = rememberLoad("alt", a.id) { repo.alternatives(a, alt) }
    val list = load.data.orEmpty()
    if (list.isEmpty()) return
    Text(title, style = MaterialTheme.typography.labelLarge, color = Freease.colors.muted, modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        list.forEach { x ->
            Row(Modifier.clip(RoundedCornerShape(50)).background(Freease.colors.card).clickable { actions.navigate(StreamRoutes.anime(x.id, epNumber.orEmpty())) }
                .padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Layers, null, Modifier.size(15.dp)); Spacer(Modifier.width(5.dp))
                Text(x.source + if (x.title != a.title) " · ${x.title}" else "", style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

// ---------------------------------------------------------------- jadwal

@OptIn(UnstableApi::class)
@Composable
fun ScheduleScreen(donghua0: Boolean) {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    var donghua by rememberSaveable { mutableStateOf(donghua0) }
    val days = listOf("Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu")
    val today = days[java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Jakarta")).get(java.util.Calendar.DAY_OF_WEEK) - 1]
    var day by rememberSaveable { mutableStateOf(today) }
    val (load, retry) = rememberLoad("sch", donghua) { repo.schedule(donghua) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
        item {
            StreamTopBar("Jadwal rilis")
            ChipRow(listOf("anime" to "Anime", "donghua" to "Donghua"), if (donghua) "donghua" else "anime", { donghua = it == "donghua" })
            Spacer(Modifier.height(6.dp))
            ChipRow((days.drop(1) + days.first()).map { d -> d to (if (d == today) "$d (hari ini)" else d) + (load.data?.firstOrNull { it.day == d }?.items?.size?.takeIf { it > 0 }?.let { " · $it" } ?: "") }, day, { day = it })
        }
        val data = load.data
        when {
            data == null -> item { if (load.error != null) ErrorBox(load.error, retry) else LoadingBox() }
            else -> {
                val list = data.firstOrNull { it.day == day }?.items.orEmpty().sortedBy { it.time?.let(::wibTime)?.takeIf { t -> t != "—" } ?: "99" }
                if (list.isEmpty()) item { EmptyBox("Tidak ada jadwal", "Belum ada judul yang tercatat rilis hari $day.") }
                items(list, key = { it.id }) { it ->
                    Row(Modifier.fillMaxWidth().clickable { actions.navigate(StreamRoutes.anime(it.id)) }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(it.time?.let(::wibTime) ?: "—", style = MaterialTheme.typography.titleSmall, color = Freease.accent.primary, modifier = Modifier.width(56.dp))
                        Cover(it.cover, Modifier.width(44.dp).height(62.dp), shape = RoundedCornerShape(8.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(it.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(it.episode.takeIf { e -> e.isNotEmpty() }?.let { e -> "Episode $e" }, it.source).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                        }
                    }
                }
                item { Text("Waktu dalam WIB. Jadwal dari sumber dan bisa bergeser.", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, modifier = Modifier.padding(16.dp)) }
            }
        }
    }
}

/** "11:48" tetap; ISO → jam WIB. */
fun wibTime(t: String): String = if (Regex("^\\d{1,2}:\\d{2}$").matches(t)) t else runCatching {
    java.time.OffsetDateTime.parse(t).atZoneSameInstant(java.time.ZoneId.of("Asia/Jakarta")).toLocalTime().toString().take(5)
}.recoverCatching { java.time.Instant.parse(t).atZone(java.time.ZoneId.of("Asia/Jakarta")).toLocalTime().toString().take(5) }.getOrDefault("—")

// ---------------------------------------------------------------- cari

@OptIn(UnstableApi::class)
@Composable
fun StreamSearchScreen() {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    var text by rememberSaveable { mutableStateOf("") }
    var q by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable { mutableStateOf("all") }
    LaunchedEffect(text) { kotlinx.coroutines.delay(600); if (text.trim().length >= 2) q = text.trim() }
    val (anime, retryA) = rememberLoad("sa", q) { if (q.isEmpty()) emptyList() else repo.searchAnime(q) }
    val (manga, retryM) = rememberLoad("sm", q) { if (q.isEmpty()) emptyList() else repo.searchManga(q) }
    LazyVerticalGrid(GridCells.Adaptive(112.dp), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = LocalBottomInset.current + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                StreamTopBar("Cari")
                OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("Judul anime, donghua, manga, manhwa…") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = { if (text.isNotEmpty()) IconButton(onClick = { text = ""; q = "" }) { Icon(Icons.Rounded.Close, "Hapus") } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { q = text.trim() }))
                if (q.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Box {
                        ChipRow(listOf("all" to "Semua", "anime" to "Anime & donghua · ${anime.data?.size ?: 0}", "manga" to "Komik · ${manga.data?.size ?: 0}"), tab, { tab = it })
                    }
                } else {
                    Text("Coba cari", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
                    Text(listOf("One Piece", "Solo Leveling", "Renegade Immortal", "Frieren", "Jujutsu Kaisen", "Omniscient Reader").joinToString(" · "),
                        color = Freease.colors.muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (q.isNotEmpty()) {
            if (tab != "manga") {
                item(span = { GridItemSpan(maxLineSpan) }) { Text("Anime & donghua", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                val list = anime.data.orEmpty().let { if (tab == "all") it.take(12) else it }
                if (anime.data == null) item(span = { GridItemSpan(maxLineSpan) }) { if (anime.error != null) ErrorBox(anime.error, retryA) else LoadingBox(Modifier.fillMaxWidth().height(100.dp)) }
                else if (list.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { EmptyBox("Tidak ketemu", "Coba ejaan lain atau judul bahasa Inggris/Jepang.") }
                items(list, key = { "a" + it.id }) { a ->
                    PosterCard(a.title, a.cover, { actions.navigate(StreamRoutes.anime(a.id)) }, width = 200.dp, sub = listOfNotNull(a.source, a.type, a.status).joinToString(" • "), badge = a.type)
                }
            }
            if (tab != "anime") {
                item(span = { GridItemSpan(maxLineSpan) }) { Text("Komik", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                val list = manga.data.orEmpty().let { if (tab == "all") it.take(18) else it }
                if (manga.data == null) item(span = { GridItemSpan(maxLineSpan) }) { if (manga.error != null) ErrorBox(manga.error, retryM) else LoadingBox(Modifier.fillMaxWidth().height(100.dp)) }
                else if (list.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { EmptyBox("Tidak ketemu", "Coba judul lain.") }
                items(list, key = { "m" + it.id }) { m ->
                    PosterCard(m.title, m.cover, { actions.navigate(StreamRoutes.manga(m.id)) }, width = 200.dp, manga = true, sub = "${m.source} · ${m.lang.uppercase()}", badge = m.type)
                }
            }
        }
    }
}

// ---------------------------------------------------------------- koleksi

@OptIn(UnstableApi::class)
@Composable
fun StreamLibraryScreen() {
    val actions = LocalActions.current
    val data by streamContainer().streamStore.data.collectAsState()
    var tab by rememberSaveable { mutableStateOf("anime") }
    val favs = data.favs.filter { it.kind == tab }
    val recent = data.recent.filter { it.kind == tab }
    LazyVerticalGrid(GridCells.Adaptive(112.dp), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = LocalBottomInset.current + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                StreamTopBar("Koleksi Stream")
                Box { ChipRow(listOf("anime" to "Anime & donghua", "manga" to "Komik"), tab, { tab = it }) }
            }
        }
        if (recent.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) { Text("Lanjutkan", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(recent, key = { "r" + it.key }) { s ->
                PosterCard(s.title, s.cover, {
                    s.itemId?.let { if (s.kind == "manga") actions.navigate(StreamRoutes.read(s.id, it)) else actions.navigate(StreamRoutes.watch(it)) }
                        ?: actions.navigate(if (s.kind == "manga") StreamRoutes.manga(s.id) else StreamRoutes.anime(s.id))
                }, width = 200.dp, sub = s.subLine, manga = s.kind == "manga", progress = s.progress)
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) { Text("Disimpan", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
        if (favs.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
            EmptyBox("Belum ada yang disimpan", "Ketuk ikon simpan di halaman judul untuk menyimpannya di sini.", Modifier.fillMaxWidth())
        }
        items(favs, key = { "f" + it.key }) { s ->
            PosterCard(s.title, s.cover, { actions.navigate(if (s.kind == "manga") StreamRoutes.manga(s.id) else StreamRoutes.anime(s.id)) }, width = 200.dp, sub = s.sub, manga = s.kind == "manga")
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text("Koleksi dan progres Stream disimpan di HP ini saja.", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
        }
    }
}
