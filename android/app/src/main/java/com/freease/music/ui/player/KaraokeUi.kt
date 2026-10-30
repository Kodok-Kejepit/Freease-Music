package com.freease.music.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MicExternalOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.freease.music.data.model.Song
import com.freease.music.karaoke.KaraokeJob
import com.freease.music.karaoke.MdxModel
import com.freease.music.karaoke.ModelState
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.theme.Freease
import com.freease.music.util.Format
import kotlinx.coroutines.launch

/** Status Mode Karaoke untuk lagu yang sedang diputar (tampil di player saat mode aktif). */
@Composable
fun KaraokeStatus(song: Song, modifier: Modifier = Modifier) {
    val actions = LocalActions.current
    val on by actions.container.karaokeMode.collectAsState()
    if (!on) return
    val jobs by actions.container.karaoke.jobs.collectAsState()
    val job = jobs[song.id]
    val savedList by actions.container.karaoke.library.items.collectAsState()
    val saving by actions.container.karaoke.saving.collectAsState()
    val saved = savedList.any { it.song.id == song.id }
    val accent = Freease.accent.primary
    val (text, progress) = when {
        song.isLive -> "Karaoke tidak tersedia untuk siaran langsung" to null
        saved -> "Karaoke aktif · tersimpan (bisa diputar offline)" to null
        song.id in saving -> "Karaoke aktif · sedang disimpan ke Karaoke tersimpan…" to null
        job is KaraokeJob.Ready -> "Karaoke aktif · vokal dihilangkan AI" to null
        job is KaraokeJob.Failed -> "Karaoke gagal: ${job.message}" to null
        job is KaraokeJob.Preparing -> {
            val pct = (job.progress * 100).toInt()
            val eta = if (job.etaSec > 0) " · ±${if (job.etaSec >= 60) "${job.etaSec / 60} mnt" else "${job.etaSec} dtk"}" else ""
            val note = if (job.speed in 0.01f..1.05f) " · versi asli diputar dulu" else ""
            "${job.phase} $pct%$eta$note" to job.progress
        }
        else -> "Menyiapkan karaoke…" to 0f
    }
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.08f)).padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.MicExternalOn, null, tint = accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(text, style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.9f), maxLines = 1)
        }
        if (progress != null) {
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = { progress }, modifier = Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)),
                color = accent, trackColor = Color.White.copy(alpha = 0.15f),
            )
        }
    }
}

/** Pertama kali menyalakan Mode Karaoke: pilih model AI, unduh (sekali saja), lalu langsung aktif. */
@Composable
fun KaraokeSetupDialog(onDismiss: () -> Unit) {
    val actions = LocalActions.current
    val c = actions.container
    val states by c.karaoke.modelStates.collectAsState()
    val current = c.settings.current.karaokeModel
    var chosen by remember { mutableStateOf(MdxModel.byId(current)) }
    var started by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    val state = states[chosen.id]
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    // Impor manual: berkas .onnx yang diunduh sendiri lewat browser/VPN (dikenali dari SHA-256-nya).
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        importing = true
        scope.launch {
            runCatching { c.karaoke.importModel(uri) }
                .onSuccess { m ->
                    chosen = m
                    c.settings.setKaraokeModel(m.id)
                    started = true
                    actions.toast("Model ${m.label} berhasil diimpor")
                }
                .onFailure { actions.toast(it.message ?: "Gagal mengimpor model") }
            importing = false
        }
    }

    LaunchedEffect(state, started) {
        if (started && state is ModelState.Ready) {
            c.karaokeMode.value = true
            actions.toast("Mode Karaoke aktif — vokal sedang dipisahkan AI")
            onDismiss()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Freease.colors.elevated,
        title = { Text("Mode Karaoke AI") },
        text = {
            Column {
                Text(
                    "Vokal dipisahkan oleh AI (model UVR MDX-Net) langsung di HP-mu — musiknya tetap utuh. " +
                        "Modelnya diunduh sekali saja.",
                    style = MaterialTheme.typography.bodyMedium, color = Freease.colors.muted,
                )
                Spacer(Modifier.height(12.dp))
                MdxModel.ALL.forEach { m ->
                    val sel = m == chosen
                    val downloaded = states[m.id] is ModelState.Ready
                    Column(
                        Modifier.padding(vertical = 4.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp))
                            .background(if (sel) Freease.accent.primary.copy(alpha = 0.16f) else Freease.colors.card)
                            .border(1.dp, if (sel) Freease.accent.primary else Color.Transparent, RoundedCornerShape(12.dp))
                            .clickable(enabled = !started) { chosen = m }
                            .padding(12.dp),
                    ) {
                        Text(
                            m.label + if (downloaded) " · sudah diunduh" else " · ${Format.bytes(m.sizeBytes)}",
                            style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
                        )
                        Text(m.description, style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                    }
                }
                when (state) {
                    is ModelState.Downloading -> {
                        Spacer(Modifier.height(12.dp))
                        Text("Mengunduh model ${(state.progress * 100).toInt()}%", style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.height(6.dp))
                        LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth(), color = Freease.accent.primary)
                    }
                    is ModelState.Failed -> {
                        Spacer(Modifier.height(10.dp))
                        Text("Gagal: ${state.message}", style = MaterialTheme.typography.bodySmall, color = Color(0xFFFF6B6B))
                    }
                    else -> Unit
                }
                if (importing) {
                    Spacer(Modifier.height(10.dp))
                    Text("Memeriksa berkas model…", style = MaterialTheme.typography.labelMedium)
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), color = Freease.accent.primary)
                }
                if (state is ModelState.Failed || state is ModelState.Missing || state == null) {
                    Spacer(Modifier.height(10.dp))
                    Row {
                        TextButton(enabled = !importing, onClick = { picker.launch(arrayOf("*/*")) }) {
                            Text("Impor file .onnx", color = Freease.accent.primary)
                        }
                        TextButton(onClick = {
                            clipboard.setText(androidx.compose.ui.text.AnnotatedString(chosen.urls.first()))
                            actions.toast("Link ${chosen.fileName} disalin — buka di browser untuk mengunduh")
                        }) { Text("Salin link", color = Freease.colors.muted) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = state !is ModelState.Downloading,
                onClick = {
                    c.settings.setKaraokeModel(chosen.id)
                    started = true
                    if (state !is ModelState.Ready) c.karaoke.downloadModel(chosen)
                },
            ) {
                Text(
                    if (state is ModelState.Ready) "Nyalakan" else if (state is ModelState.Failed) "Coba lagi" else "Unduh & nyalakan",
                    color = Freease.accent.primary,
                )
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal", color = Freease.colors.muted) } },
    )
}
