package com.freease.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.MicExternalOn
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.freease.music.data.model.Song
import com.freease.music.ui.components.EmptyState
import com.freease.music.ui.components.PlayFab
import com.freease.music.ui.components.SongRow
import com.freease.music.ui.navigation.AppActions
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.navigation.LocalBottomInset
import com.freease.music.ui.theme.Freease
import com.freease.music.util.Format

/** Putar daftar lagu dengan Mode Karaoke menyala (versi tersimpan langsung dipakai, tanpa proses AI). */
@androidx.annotation.OptIn(UnstableApi::class)
fun AppActions.playKaraoke(songs: List<Song>, start: Int = 0, shuffle: Boolean = false) {
    if (songs.isEmpty()) return
    container.karaokeMode.value = true
    player.play(songs, start, shuffle = shuffle, from = "Karaoke tersimpan")
    playerExpanded = true
}

/** Lagu-lagu yang versi karaokenya sudah tersimpan di HP. */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun KaraokeSavedScreen() {
    val actions = LocalActions.current
    val engine = actions.container.karaoke
    val items by engine.library.items.collectAsState()
    val jobs by engine.jobs.collectAsState()
    var confirmClear by remember { mutableStateOf(false) }
    var recordings by remember { mutableStateOf(actions.container.singer.recordings()) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val songs = items.map { it.song }
    val preparing = jobs.filterValues { it is com.freease.music.karaoke.KaraokeJob.Preparing }.size

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { actions.nav.popBackStack() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Kembali") }
            Column(Modifier.weight(1f)) {
                Text("Karaoke tersimpan", style = MaterialTheme.typography.titleLarge)
                Text(
                    "${items.size} lagu • ${Format.bytes(items.sumOf { it.bytes })}" + if (preparing > 0) " • $preparing sedang disiapkan" else "",
                    style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted,
                )
            }
            if (songs.isNotEmpty()) {
                IconButton(onClick = { actions.playKaraoke(songs, shuffle = true) }) { Icon(Icons.Rounded.Shuffle, "Acak") }
                PlayFab(false, { actions.playKaraoke(songs) }, Modifier.padding(end = 12.dp), size = 44.dp)
            }
        }
        if (items.isEmpty() && recordings.isEmpty()) {
            EmptyState(
                Icons.Rounded.MicExternalOn,
                "Belum ada karaoke tersimpan",
                "Setiap lagu yang selesai diproses Mode Karaoke otomatis tersimpan di sini — bisa diputar lagi kapan saja, " +
                    "langsung tanpa menunggu AI, bahkan offline. Bisa juga pilih \"Siapkan versi karaoke\" dari menu ⋮ lagu.",
            )
            return@Column
        }
        LazyColumn(contentPadding = PaddingValues(top = 6.dp, bottom = LocalBottomInset.current + 16.dp)) {
            itemsIndexed(items, key = { _, it -> it.song.id }) { i, k ->
                SongRow(
                    k.song,
                    onClick = { actions.playKaraoke(songs, i) },
                    subtitle = listOf(k.song.artist, Format.duration(k.song.durationSec), Format.bytes(k.bytes)).joinToString(" • "),
                    trailing = {
                        IconButton(onClick = { engine.library.delete(k.song.id) }) {
                            Icon(Icons.Rounded.DeleteOutline, "Hapus versi karaoke", tint = Freease.colors.muted)
                        }
                    },
                )
            }
            if (recordings.isNotEmpty()) {
                item {
                    Text("Rekaman nyanyianmu", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 16.dp, top = 18.dp, bottom = 4.dp))
                }
                itemsIndexed(recordings, key = { _, f -> "rec_" + f.name }) { _, f ->
                    val recSong = Song(
                        id = com.freease.music.data.local.LocalSongs.external(android.net.Uri.fromFile(f)),
                        title = f.nameWithoutExtension.removePrefix("Karaoke - "),
                        artist = "Rekaman karaoke",
                    )
                    SongRow(
                        recSong,
                        onClick = { actions.player.play(listOf(recSong), from = "Rekaman karaoke"); actions.playerExpanded = true },
                        subtitle = Format.bytes(f.length()) + " • " + java.text.SimpleDateFormat("d MMM yyyy HH:mm", java.util.Locale("id")).format(java.util.Date(f.lastModified())),
                        trailing = {
                            Row {
                                IconButton(onClick = {
                                    val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                                    val i = android.content.Intent(android.content.Intent.ACTION_SEND).setType("audio/mp4")
                                        .putExtra(android.content.Intent.EXTRA_STREAM, uri).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    context.startActivity(android.content.Intent.createChooser(i, "Bagikan nyanyianmu"))
                                }) { Icon(Icons.Rounded.Share, "Bagikan", tint = Freease.colors.muted) }
                                IconButton(onClick = { f.delete(); recordings = actions.container.singer.recordings() }) {
                                    Icon(Icons.Rounded.DeleteOutline, "Hapus rekaman", tint = Freease.colors.muted)
                                }
                            }
                        },
                    )
                }
            }
            if (items.isNotEmpty()) item {
                Text(
                    "Hapus semua karaoke tersimpan", color = Color(0xFFFF6B6B),
                    modifier = Modifier.padding(16.dp).clip(RoundedCornerShape(8.dp))
                        .clickable { confirmClear = true }.padding(4.dp),
                )
            }
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            containerColor = Freease.colors.elevated,
            title = { Text("Hapus semua karaoke tersimpan?") },
            text = { Text("Versi asli lagu tidak ikut terhapus. Karaoke bisa disiapkan ulang kapan saja.") },
            confirmButton = { TextButton(onClick = { engine.library.clear(); confirmClear = false }) { Text("Hapus") } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Batal") } },
        )
    }
}

/** Sampul kecil bergradasi untuk baris "Karaoke tersimpan" di Koleksi. */
@Composable
fun KaraokeCover(modifier: Modifier = Modifier) {
    Box(
        modifier.background(Brush.linearGradient(listOf(Color(0xFFFF4D8D), Color(0xFF6A3DFF)))),
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Rounded.MicExternalOn, null, tint = Color.White, modifier = Modifier.size(30.dp)) }
}
