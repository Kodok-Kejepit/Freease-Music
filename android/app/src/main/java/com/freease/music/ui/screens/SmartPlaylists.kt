package com.freease.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.freease.music.data.model.Song
import com.freease.music.ui.components.CollectionScreen
import com.freease.music.ui.components.EmptyState
import com.freease.music.ui.navigation.AppActions
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.theme.Freease
import com.freease.music.util.Format
import kotlinx.coroutines.flow.first

/** Playlist yang menyusun dirinya sendiri dari kebiasaan dengarmu. */
enum class SmartList(val title: String, val subtitle: String, val icon: ImageVector, val colors: List<Color>) {
    TOP_MONTH("Sering kamu putar", "Lagu paling sering 30 hari terakhir", Icons.Rounded.TrendingUp, listOf(Color(0xFFFF6437), Color(0xFFE8115B))),
    ON_REPEAT("Diulang terus", "Lagu yang kamu putar berkali-kali minggu ini", Icons.Rounded.Repeat, listOf(Color(0xFF7B4DFF), Color(0xFF2D46B9))),
    FORGOTTEN("Lama tak didengar", "Lagu kesukaan yang sudah sebulan tidak diputar", Icons.Rounded.History, listOf(Color(0xFF27856A), Color(0xFF1E3264))),
    NEW_LIKES("Baru disukai", "Lagu yang terakhir kamu tandai suka", Icons.Rounded.Favorite, listOf(Color(0xFFF037A5), Color(0xFF8C1932))),
    ;

    suspend fun load(a: AppActions): List<Song> {
        val lib = a.library
        val now = System.currentTimeMillis()
        return when (this) {
            TOP_MONTH -> lib.topSongs(now - 30 * 86_400_000L, 50).first().map { it.song.toSong() }
            ON_REPEAT -> lib.topSongs(now - 7 * 86_400_000L, 50).first().filter { it.plays >= 3 }.map { it.song.toSong() }
            FORGOTTEN -> lib.forgottenLiked(30, 100).shuffled()
            NEW_LIKES -> lib.likedSongs(50)
        }
    }
}

@Composable
fun SmartListCover(list: SmartList, modifier: Modifier = Modifier, iconSize: androidx.compose.ui.unit.Dp = 30.dp) {
    Box(modifier.background(Brush.linearGradient(list.colors)), contentAlignment = Alignment.Center) {
        Icon(list.icon, null, tint = Color.White, modifier = Modifier.size(iconSize))
    }
}

/** Baris pintasan playlist pintar di Koleksi. */
@Composable
fun SmartListRow(list: SmartList, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SmartListCover(list, Modifier.size(60.dp).clip(RoundedCornerShape(8.dp)))
        Spacer(Modifier.width(14.dp))
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(list.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(6.dp))
                Icon(Icons.Rounded.AutoAwesome, "Playlist pintar", tint = Freease.accent.primary, modifier = Modifier.size(14.dp))
            }
            Text("Playlist pintar • ${list.subtitle}", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted, maxLines = 1)
        }
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun SmartPlaylistScreen(kind: String) {
    val actions = LocalActions.current
    val list = SmartList.entries.firstOrNull { it.name == kind } ?: SmartList.TOP_MONTH
    var songs by remember { mutableStateOf<List<Song>?>(null) }
    LaunchedEffect(list) { songs = runCatching { list.load(actions) }.getOrDefault(emptyList()) }
    val shown = songs.orEmpty()
    CollectionScreen(
        title = list.title,
        subtitle = "Playlist pintar • ${shown.size} lagu • ${Format.longDuration(shown.sumOf { it.durationSec })}\n${list.subtitle}",
        from = list.title,
        songs = shown,
        colorUrl = shown.firstOrNull()?.artworkSmall,
        loading = songs == null,
        cover = { m -> SmartListCover(list, m.clip(RoundedCornerShape(10.dp)), iconSize = 84.dp) },
        empty = {
            EmptyState(list.icon, "Belum ada lagu di sini", "Playlist ini terisi sendiri seiring kamu mendengarkan musik.", modifier = Modifier.fillMaxSize())
        },
    )
}
