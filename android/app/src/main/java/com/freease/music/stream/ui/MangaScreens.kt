package com.freease.music.stream.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.SwapVert
import androidx.compose.material.icons.rounded.Translate
import androidx.compose.material.icons.rounded.ViewAgenda
import androidx.compose.material.icons.rounded.ViewCarousel
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.util.UnstableApi
import coil3.compose.SubcomposeAsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import com.freease.music.stream.data.Bubble
import com.freease.music.stream.data.Img
import com.freease.music.stream.data.Manga
import com.freease.music.stream.data.Saved
import com.freease.music.stream.data.UA_DESKTOP
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.navigation.LocalBottomInset
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.launch
import kotlin.math.sqrt

// ---------------------------------------------------------------- daftar per sumber

private val MTYPES = listOf("" to "Semua", "manga" to "Manga", "manhwa" to "Manhwa", "manhua" to "Manhua")

@OptIn(UnstableApi::class)
@Composable
fun MangaBrowseScreen(src0: String) {
    val actions = LocalActions.current
    val repo = streamContainer().stream
    var src by rememberSaveable { mutableStateOf(src0.ifEmpty { "km" }) }
    var order by rememberSaveable { mutableStateOf("popular") }
    var type by rememberSaveable { mutableStateOf("") }
    val source = repo.mangaSource(src) ?: repo.mangaSources.first()
    val items = remember(src, order, type) { mutableStateListOf<Manga>() }
    var page by remember(src, order, type) { mutableIntStateOf(1) }
    var hasMore by remember(src, order, type) { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun loadMore() {
        if (loading || !hasMore) return
        loading = true; error = null
        scope.launch {
            runCatching { repo.browseManga(source.key, order, page, type.ifEmpty { null }) }
                .onSuccess { r -> val fresh = r.filter { n -> items.none { it.id == n.id } }; items.addAll(fresh); hasMore = fresh.isNotEmpty() && source.key != "wt"; page++ }
                .onFailure { error = it.message ?: "Gagal memuat" }
            loading = false
        }
    }
    LaunchedEffect(src, order, type) { loadMore() }
    LazyVerticalGrid(GridCells.Adaptive(112.dp), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = LocalBottomInset.current + 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                StreamTopBar("Komik")
                ChipRow(repo.mangaSources.map { it.key to "${it.name} · ${it.lang.uppercase()}" }, source.key, { src = it; type = ""; order = "popular" })
                if (source.hasOrder) { Spacer(Modifier.height(6.dp)); ChipRow(listOf("popular" to "Populer", "latest" to "Baru update"), order, { order = it }) }
                if (source.hasType) { Spacer(Modifier.height(6.dp)); ChipRow(MTYPES, type, { type = it }) }
                Spacer(Modifier.height(10.dp))
            }
        }
        items(items, key = { it.id }) { m ->
            PosterCard(m.title, m.cover, { actions.navigate(StreamRoutes.manga(m.id)) }, width = 200.dp, manga = true, sub = m.source, badge = m.type, badgeEnd = m.latest?.let { "Ch $it" })
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            when {
                loading -> LoadingBox(Modifier.fillMaxWidth().height(80.dp))
                error != null -> ErrorBox(error!!, { loadMore() })
                items.isEmpty() -> EmptyBox("Tidak ada judul", "Coba sumber atau filter lain.")
                hasMore -> OutlinedButton(onClick = { loadMore() }, modifier = Modifier.fillMaxWidth()) { Text("Muat lebih banyak") }
            }
        }
    }
}

// ---------------------------------------------------------------- detail

@OptIn(UnstableApi::class, ExperimentalLayoutApi::class)
@Composable
fun MangaDetailScreen(id: String) {
    val actions = LocalActions.current
    val c = streamContainer()
    val (load, retry) = rememberLoad(id) { c.stream.mangaDetail(id) }
    val store by c.streamStore.data.collectAsState()
    var newest by rememberSaveable { mutableStateOf(true) }
    var more by remember { mutableStateOf(false) }
    val d = load.data
    if (d == null) { Column(Modifier.fillMaxSize()) { StreamTopBar(""); if (load.error != null) ErrorBox(load.error, retry) else LoadingBox() }; return }
    val m = d.manga
    val prog = store.recent.firstOrNull { it.kind == "manga" && it.id == m.id }
    val chapters = if (newest) d.chapters.reversed() else d.chapters
    val (alts, _) = rememberLoad("malt", m.id) { c.stream.mangaAlternatives(m) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + 16.dp)) {
        item {
            StreamTopBar("") { FavButton(Saved("manga", m.id, m.title, m.cover, "${m.source} · ${m.lang.uppercase()}")) }
            Column(Modifier.padding(horizontal = 16.dp)) {
                Row {
                    Cover(m.cover, Modifier.width(120.dp).height(180.dp), manga = true, shape = RoundedCornerShape(14.dp))
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text((m.type ?: "Komik").uppercase(), style = MaterialTheme.typography.labelSmall, color = Freease.accent.primary, fontWeight = FontWeight.Bold)
                        Text(m.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Spacer(Modifier.height(6.dp))
                        Text(listOfNotNull(d.status, d.author, "${d.chapters.size} bab", "${m.source} · ${m.lang.uppercase()}").joinToString(" • "), style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                    }
                }
                Spacer(Modifier.height(14.dp))
                val first = d.chapters.firstOrNull()
                val target = prog?.itemId?.let { it to "Lanjutkan ${prog.itemLabel.orEmpty()}" } ?: first?.let { it.id to "Baca ${it.label}" }
                target?.let { (cid, label) ->
                    Button(onClick = { actions.navigate(StreamRoutes.read(m.id, cid)) }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Freease.accent.primary)) {
                        Icon(Icons.AutoMirrored.Rounded.MenuBook, null); Spacer(Modifier.width(6.dp)); Text(label)
                    }
                }
                if (d.genres.isNotEmpty()) FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    d.genres.forEach { g -> Text(g, style = MaterialTheme.typography.labelMedium, modifier = Modifier.clip(RoundedCornerShape(50)).background(Freease.colors.card).padding(horizontal = 10.dp, vertical = 5.dp)) }
                }
                if (d.description.isNotBlank()) Text(d.description, style = MaterialTheme.typography.bodyMedium, maxLines = if (more) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 12.dp).clickable { more = !more })
                if (d.partial) Text("Sumber ini cuma memberi bab-bab awal dan terbaru. Bab lengkapnya coba lewat sumber lain di bawah.", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, modifier = Modifier.padding(top = 10.dp))
                alts.data?.takeIf { it.isNotEmpty() }?.let { list ->
                    Text("Juga tersedia di", style = MaterialTheme.typography.labelLarge, color = Freease.colors.muted, modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        list.forEach { x ->
                            Row(Modifier.clip(RoundedCornerShape(50)).background(Freease.colors.card).clickable { actions.navigate(StreamRoutes.manga(x.id)) }.padding(horizontal = 12.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.Layers, null, Modifier.size(15.dp)); Spacer(Modifier.width(5.dp)); Text("${x.source} · ${x.lang.uppercase()}", style = MaterialTheme.typography.labelMedium) }
                        }
                    }
                }
                Row(Modifier.padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Bab", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = { newest = !newest }) { Icon(Icons.Rounded.SwapVert, null); Text(if (newest) "Terbaru dulu" else "Terlama dulu") }
                }
            }
        }
        itemsIndexed(chapters, key = { _, ch -> ch.id }) { _, ch ->
            val seen = store.seen[ch.id]
            val cur = prog?.itemId == ch.id
            Row(Modifier.fillMaxWidth().clickable { actions.navigate(StreamRoutes.read(m.id, ch.id)) }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(ch.label, fontWeight = FontWeight.SemiBold, color = when { cur -> Freease.accent.primary; seen != null -> Freease.colors.muted; else -> MaterialTheme.colorScheme.onBackground })
                    ch.title?.takeIf { ch.number != null }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                Text(timeAgo(ch.at), style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
            }
        }
    }
}

// ---------------------------------------------------------------- pembaca

@OptIn(UnstableApi::class, ExperimentalFoundationApi::class)
@Composable
fun ReaderScreen(mangaId: String, chapterId: String) {
    val actions = LocalActions.current
    val c = streamContainer()
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("stream_reader", 0) }
    val (manga, _) = rememberLoad(mangaId) { c.stream.mangaDetail(mangaId) }
    val (pages, retry) = rememberLoad(chapterId) { c.stream.pages(chapterId) }
    var paged by rememberSaveable { mutableStateOf(prefs.getBoolean("paged", false)) }
    var translate by rememberSaveable { mutableStateOf(prefs.getBoolean("translate", false)) }
    var ui by remember { mutableStateOf(true) }
    var page by remember(chapterId) { mutableIntStateOf(0) }
    val d = manga.data
    val list = pages.data.orEmpty()
    val idx = d?.chapters?.indexOfFirst { it.id == chapterId } ?: -1
    val ch = d?.chapters?.getOrNull(idx)
    val prev = if (idx > 0) d?.chapters?.getOrNull(idx - 1) else null
    val next = if (idx >= 0) d?.chapters?.getOrNull(idx + 1) else null
    fun go(id: String) = actions.nav.navigate(StreamRoutes.read(mangaId, id)) { popUpTo(actions.nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } }

    // Lanjut dari halaman terakhir bab ini; posisi disimpan saat halaman berganti.
    val start = remember(chapterId) { c.streamStore.seen(chapterId)?.takeIf { it.dur > 1 && it.pos < it.dur - 1 }?.pos?.toInt() ?: 0 }
    LaunchedEffect(d, ch, page, list.size) {
        val m = d?.manga ?: return@LaunchedEffect
        val chap = ch ?: return@LaunchedEffect
        if (list.isEmpty()) return@LaunchedEffect
        kotlinx.coroutines.delay(600)
        c.streamStore.saveProgress(Saved("manga", m.id, m.title, m.cover, "${m.source} · ${m.lang.uppercase()}", chap.id, chap.label, page.toLong(), list.size.toLong()))
    }
    // Bab berikutnya dimuat lebih dulu.
    LaunchedEffect(page, next, list.size) { if (next != null && list.isNotEmpty() && page > list.size * 0.6) runCatching { c.stream.pages(next.id) } }

    Box(Modifier.fillMaxSize().background(Color(0xFF050508))) {
        when {
            pages.data == null -> if (pages.error != null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { ErrorBox(pages.error, retry) } else LoadingBox(Modifier.fillMaxSize())
            paged -> {
                val pager = rememberPagerState(initialPage = start.coerceIn(0, (list.size - 1).coerceAtLeast(0))) { list.size }
                LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect { page = it } }
                HorizontalPager(pager, Modifier.fillMaxSize()) { i ->
                    Box(Modifier.fillMaxSize().clickable { ui = !ui }, contentAlignment = Alignment.Center) { ReaderPage(list[i], i, translate, fit = true) }
                }
            }
            else -> {
                val state = rememberLazyListState(initialFirstVisibleItemIndex = start.coerceIn(0, (list.size).coerceAtLeast(0)))
                LaunchedEffect(state) { snapshotFlow { state.firstVisibleItemIndex }.collect { page = it.coerceAtMost((list.size - 1).coerceAtLeast(0)) } }
                LazyColumn(Modifier.fillMaxSize().clickable { ui = !ui }, state = state) {
                    itemsIndexed(list, key = { i, p -> "$i${p.url}" }) { i, p -> ReaderPage(p, i, translate, fit = false) }
                    item {
                        Column(Modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 18.dp).navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Selesai: ${ch?.label ?: "bab ini"}", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Color.White)
                            Spacer(Modifier.height(12.dp))
                            if (next != null) Button(onClick = { go(next.id) }, colors = ButtonDefaults.buttonColors(containerColor = Freease.accent.primary)) { Text("Lanjut ${next.label}"); Icon(Icons.Rounded.ChevronRight, null) }
                            else Text("Ini bab terakhir yang tersedia.", color = Freease.colors.muted)
                            TextButton(onClick = { actions.nav.popBackStack() }) { Text("Kembali ke daftar bab") }
                        }
                    }
                }
            }
        }
        if (ui) {
            Row(Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.75f)).statusBarsPadding().padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { actions.nav.popBackStack() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Kembali", tint = Color.White) }
                Column(Modifier.weight(1f)) {
                    Text(d?.manga?.title ?: "Memuat…", color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(ch?.label, if (list.isNotEmpty()) "Halaman ${page + 1} / ${list.size}" else null).joinToString(" · "), color = Freease.colors.muted, style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { translate = !translate; prefs.edit().putBoolean("translate", translate).apply(); if (translate) actions.toast("Terjemahan nyala: teks komik diterjemahkan ke bahasa Indonesia") }) {
                    Icon(Icons.Rounded.Translate, "Terjemahkan", tint = if (translate) Freease.accent.primary else Color.White)
                }
                IconButton(onClick = { paged = !paged; prefs.edit().putBoolean("paged", paged).apply() }) {
                    Icon(if (paged) Icons.Rounded.ViewAgenda else Icons.Rounded.ViewCarousel, if (paged) "Mode gulir" else "Mode per halaman", tint = Color.White)
                }
            }
            Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.75f)).navigationBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { prev?.let { go(it.id) } }, enabled = prev != null) { Icon(Icons.Rounded.ChevronLeft, "Bab sebelumnya", tint = if (prev != null) Color.White else Color.Gray) }
                Text(ch?.label ?: "", color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                IconButton(onClick = { next?.let { go(it.id) } }, enabled = next != null) { Icon(Icons.Rounded.ChevronRight, "Bab berikutnya", tint = if (next != null) Color.White else Color.Gray) }
            }
        }
    }
}

/** Satu halaman komik; bila terjemahan nyala, kotak teks Indonesia ditaruh di atas balon kata. */
@OptIn(UnstableApi::class)
@Composable
private fun ReaderPage(p: Img, i: Int, translate: Boolean, fit: Boolean) {
    val ctx = LocalContext.current
    val c = streamContainer()
    val req = remember(p) {
        ImageRequest.Builder(ctx).data(p.url).apply { httpHeaders(NetworkHeaders.Builder().set("User-Agent", UA_DESKTOP).apply { p.referer?.let { set("Referer", it) } }.build()) }.build()
    }
    var bubbles by remember(p, translate) { mutableStateOf<List<Bubble>?>(null) }
    var busy by remember(p, translate) { mutableStateOf(false) }
    var showOriginal by remember(p) { mutableStateOf(false) }
    LaunchedEffect(p, translate) {
        if (!translate) return@LaunchedEffect
        busy = true
        bubbles = runCatching { c.stream.translator.translate(p) }.getOrNull()
        busy = false
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        var ratio by remember(p) { mutableStateOf(0f) }
        Box(if (fit) Modifier.fillMaxSize() else Modifier.fillMaxWidth()) {
            SubcomposeAsyncImage(
                model = req, contentDescription = "Halaman ${i + 1}", contentScale = if (fit) ContentScale.Fit else ContentScale.FillWidth,
                modifier = if (fit) Modifier.fillMaxSize() else Modifier.fillMaxWidth().heightIn(min = 120.dp),
                loading = { Box(Modifier.fillMaxWidth().height(400.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Freease.accent.primary) } },
                error = { Box(Modifier.fillMaxWidth().height(300.dp), contentAlignment = Alignment.Center) { Text("Halaman ${i + 1} gagal dimuat", color = Freease.colors.muted) } },
                onSuccess = { s -> ratio = s.result.image.width.toFloat() / s.result.image.height.coerceAtLeast(1) },
            )
            val b = bubbles
            if (!fit && translate && b != null && !showOriginal && ratio > 0f) {
                val wPx = constraints.maxWidth.toFloat()
                val hPx = wPx / ratio
                val density = LocalDensity.current
                b.forEach { bb ->
                    with(density) {
                        val w = bb.w * wPx; val h = bb.h * hPx
                        val fs = (sqrt((w * h) / bb.text.length.coerceAtLeast(8)) * 0.9f).toSp().value.coerceIn(9f, 20f)
                        Text(bb.text, color = Color(0xFF111111), fontWeight = FontWeight.Bold, fontSize = fs.sp, lineHeight = (fs * 1.15f).sp, textAlign = TextAlign.Center,
                            modifier = Modifier.offset((bb.x * wPx - 4).toDp(), (bb.y * hPx - 4).toDp()).width((w + 8).toDp()).heightIn(min = (h + 8).toDp())
                                .clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.96f)).padding(3.dp))
                    }
                }
            }
            if (translate && !fit) {
                if (busy) Text("Menerjemahkan…", color = Color.White, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(8.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.65f)).padding(horizontal = 10.dp, vertical = 4.dp))
                else if (!b.isNullOrEmpty()) Text(if (showOriginal) "Tampilkan terjemahan" else "Lihat asli", color = Color.White, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.align(Alignment.TopEnd).padding(8.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.65f)).clickable { showOriginal = !showOriginal }.padding(horizontal = 10.dp, vertical = 4.dp))
            }
        }
    }
}
