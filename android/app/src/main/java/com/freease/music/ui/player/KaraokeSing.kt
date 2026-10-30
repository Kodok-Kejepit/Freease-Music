package com.freease.music.ui.player

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FiberManualRecord
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.TrackChanges
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.media3.common.util.UnstableApi
import com.freease.music.data.model.Song
import com.freease.music.karaoke.KaraokeSinger
import com.freease.music.karaoke.MdxModel
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.launch
import kotlin.math.abs

/** Volume vokal asli, skor nyanyi, dan rekam nyanyian — tampil di pemutar selama Mode Karaoke aktif. */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun KaraokeTools(song: Song, modifier: Modifier = Modifier) {
    val actions = LocalActions.current
    val c = actions.container
    val on by c.karaokeMode.collectAsState()
    if (!on || song.isLive) return
    val context = LocalContext.current
    val settings by c.settings.flow.collectAsState()
    val singer = c.singer
    val live by singer.live.collectAsState()
    val state by actions.player.state.collectAsState()
    val scope = rememberCoroutineScope()
    var vocal by remember(settings.vocalLevel) { mutableFloatStateOf(settings.vocalLevel.toFloat()) }
    var result by remember { mutableStateOf<KaraokeSinger.Result?>(null) }
    var preparing by remember { mutableStateOf(false) }
    var wantRecord by remember { mutableStateOf(false) }
    val accent = Freease.accent.primary

    fun finish() {
        val r = singer.stop()
        c.wake.useMic("karaoke", false)
        if (r != null) result = r else actions.toast("Belum cukup bernyanyi untuk dinilai")
    }

    fun begin(record: Boolean) {
        val m = MdxModel.byId(settings.karaokeModel)
        preparing = true
        scope.launch {
            // Butuh trek vokal asli sebagai acuan nada: dari cache, atau dipulihkan dari Karaoke tersimpan.
            var vox = c.karaoke.vocalFile(m, song.id)
            if (!vox.exists() && c.karaoke.library.has(song.id)) {
                if (c.karaoke.restoreSaved(m, song.id)) vox = c.karaoke.vocalFile(m, song.id)
            }
            preparing = false
            if (!vox.exists()) {
                actions.toast("Tunggu versi karaoke lagu ini selesai disiapkan dulu")
                return@launch
            }
            c.wake.useMic("karaoke", true)
            singer.start(song, vox, record)
            actions.toast(if (record) "Merekam & menilai — nyanyi yuk!" else "Skor nyala — nyanyi yuk!")
        }
    }

    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) begin(wantRecord) else actions.toast("Izin mikrofon dibutuhkan untuk skor & rekam karaoke")
    }

    fun request(record: Boolean) {
        wantRecord = record
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin(record)
        else mic.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Posisi lagu untuk pencocokan nada; lagu berganti → sesi selesai.
    LaunchedEffect(live.active) {
        if (!live.active) return@LaunchedEffect
        actions.player.positionFlow(100).collect { singer.positionMs = it }
    }
    LaunchedEffect(state.isPlaying) { singer.playing = state.isPlaying }
    LaunchedEffect(song.id) { if (live.active && live.songId != song.id) finish() }

    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.06f))
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Vokal asli", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.85f), modifier = Modifier.width(72.dp))
            Slider(
                value = vocal, onValueChange = { vocal = it }, valueRange = 0f..100f,
                onValueChangeFinished = { c.settings.setVocalLevel(vocal.toInt()) },
                colors = SliderDefaults.colors(thumbColor = accent, activeTrackColor = accent),
                modifier = Modifier.weight(1f),
            )
            Text("${vocal.toInt()}%", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.85f), modifier = Modifier.width(40.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (live.active) {
                val (hint, col) = when {
                    !live.singing -> "Ayo nyanyi…" to Color.White.copy(alpha = 0.7f)
                    live.diff.isNaN() -> "Nada belum terbaca" to Color.White.copy(alpha = 0.7f)
                    abs(live.diff) <= 1f -> "Pas!" to Color(0xFF3DDC84)
                    live.diff > 0 -> "Turunkan sedikit" to Color(0xFFFFC94D)
                    else -> "Naikkan sedikit" to Color(0xFFFFC94D)
                }
                Text("${live.score}", fontSize = 26.sp, fontWeight = FontWeight.Black, color = accent)
                Column(Modifier.weight(1f)) {
                    Text(if (live.recording) "Merekam · skor" else "Skor nyanyi", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
                    Text(hint, style = MaterialTheme.typography.labelLarge, color = col)
                }
                Chip(Icons.Rounded.Stop, "Selesai", Color(0xFFFF4D4D)) { finish() }
            } else if (preparing) {
                CircularProgressIndicator(Modifier.size(18.dp), color = accent, strokeWidth = 2.dp)
                Text("Menyiapkan acuan nada…", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.8f))
            } else {
                Chip(Icons.Rounded.TrackChanges, "Skor nyanyi", accent) { request(false) }
                Chip(Icons.Rounded.FiberManualRecord, "Rekam", Color(0xFFFF4D4D)) { request(true) }
                Spacer(Modifier.weight(1f))
                Text("Pakai headset = skor lebih akurat", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f))
            }
        }
    }

    result?.let { r -> SingResultDialog(r) { result = null } }
}

@Composable
private fun Chip(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, color = Color.White)
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
private fun SingResultDialog(r: KaraokeSinger.Result, onDismiss: () -> Unit) {
    val actions = LocalActions.current
    val c = actions.container
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    val grade = when {
        r.score >= 90 -> "Luar biasa! Penyanyi beneran nih"
        r.score >= 75 -> "Mantap! Nadanya banyak yang pas"
        r.score >= 55 -> "Lumayan! Sedikit lagi makin pas"
        r.score >= 35 -> "Terus latihan, pasti makin bagus"
        else -> "Yang penting happy!"
    }
    fun share(file: java.io.File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND).setType("audio/mp4").putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_TEXT, "Aku nyanyi ${r.song.title} di Freease Karaoke — skor ${r.score}!")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(intent, "Bagikan nyanyianmu").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AlertDialog(
        onDismissRequest = { if (!saving) { r.recording?.delete(); onDismiss() } },
        containerColor = Freease.colors.elevated,
        title = { Text(r.song.title, maxLines = 1) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text("${r.score}", fontSize = 64.sp, fontWeight = FontWeight.Black, color = Freease.accent.primary)
                Text(grade, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.size(8.dp))
                Text("Ketepatan nada ${r.accuracy}% · bagian dinyanyikan ${r.coverage}%", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                if (saving) {
                    Spacer(Modifier.size(12.dp))
                    CircularProgressIndicator(color = Freease.accent.primary)
                    Text("Menggabungkan suaramu dengan musik…", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                }
            }
        },
        confirmButton = {
            if (r.recording != null) {
                TextButton(enabled = !saving, onClick = {
                    saving = true
                    scope.launch {
                        val m = MdxModel.byId(c.settings.current.karaokeModel)
                        val inst = c.karaoke.output(m, r.song.id)?.file
                        val res = runCatching { c.singer.export(r, inst ?: error("Instrumen tidak ditemukan")) }
                        saving = false
                        res.onSuccess { f ->
                            actions.toast("Tersimpan di Musik/Freease Karaoke")
                            share(f)
                            onDismiss()
                        }.onFailure { actions.toast("Gagal menyimpan: ${it.message}") }
                    }
                }) { Text("Simpan & bagikan") }
            } else {
                TextButton(onClick = {
                    actions.shareText("Aku dapat skor ${r.score} nyanyi ${r.song.title} — ${r.song.artist} di Freease Karaoke")
                }) { Text("Bagikan skor") }
            }
        },
        dismissButton = {
            TextButton(enabled = !saving, onClick = { r.recording?.delete(); onDismiss() }) { Text(if (r.recording != null) "Buang" else "Tutup") }
        },
    )
}
