package com.freease.music.stream.ui

import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import coil3.compose.SubcomposeAsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import com.freease.music.AppContainer
import com.freease.music.stream.data.Img
import com.freease.music.stream.data.Saved
import com.freease.music.stream.data.SourceException
import com.freease.music.ui.components.SectionHeader
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.theme.Freease

/** Rute halaman Freease Stream (ID dikodekan karena memuat ':' dan '/'). */
object StreamRoutes {
    const val HOME = "stream?tab={tab}"
    const val BROWSE = "stream/anime?src={src}&order={order}&status={status}&genre={genre}"
    const val ANIME = "stream/a/{id}?ep={ep}&play={play}"
    const val WATCH = "stream/watch/{id}"
    const val SCHEDULE = "stream/schedule?dh={dh}"
    const val SEARCH = "stream/search"
    const val LIBRARY = "stream/library"
    const val MANGA_BROWSE = "stream/komik?src={src}"
    const val MANGA = "stream/m/{id}"
    const val READ = "stream/read/{mid}/{cid}"

    /** Tab yang diminta dibuka (beranda Stream yang sudah terbuka ikut pindah, walau rutenya sama). */
    val requestedTab = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    fun home(tab: String = "anime"): String { requestedTab.value = tab; return "stream?tab=$tab" }
    fun browse(src: String = "", order: String = "", status: String = "", genre: String = "") =
        "stream/anime?src=$src&order=$order&status=$status&genre=${Uri.encode(genre)}"
    fun anime(id: String, ep: String = "", play: Boolean = false) = "stream/a/${Uri.encode(id)}?ep=${Uri.encode(ep)}&play=$play"
    fun watch(id: String) = "stream/watch/${Uri.encode(id)}"
    fun schedule(donghua: Boolean = false) = "stream/schedule?dh=$donghua"
    fun mangaBrowse(src: String = "km") = "stream/komik?src=$src"
    fun manga(id: String) = "stream/m/${Uri.encode(id)}"
    fun read(mangaId: String, chapterId: String) = "stream/read/${Uri.encode(mangaId)}/${Uri.encode(chapterId)}"
}

@OptIn(UnstableApi::class)
@Composable
fun streamContainer(): AppContainer = LocalActions.current.container

/** Hasil muat sederhana untuk layar Stream. */
class Load<T>(val data: T?, val error: String?, val loading: Boolean)

@OptIn(UnstableApi::class)
@Composable
fun <T> rememberLoad(vararg keys: Any?, block: suspend () -> T): Pair<Load<T>, () -> Unit> {
    var state by remember(*keys) { mutableStateOf(Load<T>(null, null, true)) }
    var tick by remember(*keys) { mutableStateOf(0) }
    LaunchedEffect(*keys, tick) {
        state = Load(state.data, null, true)
        state = try { Load(block(), null, false) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) {
            Load(state.data, (e as? SourceException)?.message ?: "Gagal memuat. Periksa koneksi internet.", false)
        }
    }
    return state to { tick++ }
}

/** Gambar sampul dengan Referer sumbernya (CDN komik/anime sering menolak tanpa itu). */
@Composable
fun Cover(img: Img?, modifier: Modifier = Modifier, manga: Boolean = false, shape: RoundedCornerShape = RoundedCornerShape(10.dp)) {
    val ctx = LocalContext.current
    val accent = Freease.accent
    val bg = Modifier.clip(shape).background(Brush.linearGradient(listOf(accent.primary.copy(alpha = 0.3f), accent.secondary.copy(alpha = 0.15f), Color(0xFF1C1C28))))
    if (img == null) {
        Box(modifier.then(bg), contentAlignment = Alignment.Center) { Icon(if (manga) Icons.Rounded.MenuBook else Icons.Rounded.Movie, null, tint = Color.White.copy(alpha = 0.55f)) }
        return
    }
    val req = remember(img) {
        ImageRequest.Builder(ctx).data(img.url).apply {
            img.referer?.let { httpHeaders(NetworkHeaders.Builder().set("Referer", it).set("User-Agent", com.freease.music.stream.data.UA_DESKTOP).build()) }
        }.build()
    }
    SubcomposeAsyncImage(
        model = req, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier.then(bg),
        error = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Icon(if (manga) Icons.Rounded.MenuBook else Icons.Rounded.Movie, null, tint = Color.White.copy(alpha = 0.55f)) } },
    )
}

@Composable
fun Badge(text: String, modifier: Modifier = Modifier, accent: Boolean = false) {
    val a = Freease.accent
    Text(
        text, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 1,
        modifier = modifier.clip(RoundedCornerShape(6.dp))
            .background(if (accent) Brush.linearGradient(listOf(a.primary, a.secondary)) else Brush.linearGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Black.copy(alpha = 0.7f))))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/** Kartu poster (rasio 2:3) dengan lencana kiri-atas dan kanan-atas, judul dua baris, keterangan kecil. */
@Composable
fun PosterCard(
    title: String, cover: Img?, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp = 128.dp,
    sub: String? = null, badge: String? = null, badgeEnd: String? = null, manga: Boolean = false, progress: Float = 0f,
) {
    Column(modifier.width(width).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick)) {
        Box {
            Cover(cover, Modifier.fillMaxWidth().aspectRatio(2f / 3f), manga)
            badge?.let { Badge(it, Modifier.align(Alignment.TopStart).padding(6.dp)) }
            badgeEnd?.let { Badge(it, Modifier.align(Alignment.TopEnd).padding(6.dp), accent = true) }
            if (progress > 0f) Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.2f))) {
                Box(Modifier.fillMaxWidth(progress).height(3.dp).background(Brush.linearGradient(listOf(Freease.accent.primary, Freease.accent.secondary))))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        sub?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

/** Rak horizontal ala beranda Freease. */
@Composable
fun <T> Shelf(title: String, items: List<T>, action: String? = "Lihat semua", onMore: (() -> Unit)? = null, key: (T) -> Any, card: @Composable (T) -> Unit) {
    if (items.isEmpty()) return
    SectionHeader(title, action = if (onMore != null) action else null, onAction = onMore)
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(items, key = key) { card(it) }
    }
}

@Composable
fun ChipRow(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (v, label) ->
            FilterChip(
                selected = selected == v, onClick = { onSelect(v) }, label = { Text(label) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Freease.accent.primary.copy(alpha = 0.3f)),
            )
        }
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier.fillMaxWidth().height(220.dp)) {
    Box(modifier, contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Freease.accent.primary) }
}

@Composable
fun ErrorBox(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(message, color = Freease.colors.muted, textAlign = TextAlign.Center)
        TextButton(onClick = onRetry) { Text("Coba lagi") }
    }
}

@Composable
fun EmptyBox(title: String, sub: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(sub, color = Freease.colors.muted, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
    }
}

/** Tombol simpan ke koleksi Stream. */
@OptIn(UnstableApi::class)
@Composable
fun FavButton(item: Saved) {
    val c = streamContainer()
    val store = c.streamStore
    val data by store.data.collectAsState()
    val on = data.favs.any { it.key == item.key }
    IconButton(onClick = { store.toggleFav(item); c.emitMessage(if (on) "Dihapus dari koleksi" else "Disimpan ke koleksi") }) {
        Icon(if (on) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, "Simpan", tint = if (on) Freease.accent.primary else MaterialTheme.colorScheme.onBackground)
    }
}

fun timeAgo(ms: Long?): String {
    if (ms == null || ms <= 0) return ""
    val d = (System.currentTimeMillis() - ms) / 1000
    return when {
        d < 60 -> "baru saja"
        d < 3600 -> "${d / 60} mnt lalu"
        d < 86400 -> "${d / 3600} jam lalu"
        d < 86400 * 30 -> "${d / 86400} hari lalu"
        else -> java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale("id")).format(java.util.Date(ms))
    }
}

val Saved.subLine: String get() = listOfNotNull(itemLabel, sub).joinToString(" • ")
