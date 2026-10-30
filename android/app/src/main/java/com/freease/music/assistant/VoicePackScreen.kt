package com.freease.music.assistant

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.FiberManualRecord
import androidx.compose.material.icons.rounded.FileOpen
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import androidx.core.content.ContextCompat
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.navigation.LocalBottomInset
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Suara Dev: klip jawaban asisten bawaan, bisa ditimpa rekaman/impor sendiri. */
@Composable
fun VoicePackScreen() {
    val actions = LocalActions.current
    val context = LocalContext.current
    val pack = actions.container.voicePack
    val clips by pack.clips.collectAsState()
    var recording by remember { mutableStateOf<VoicePack.Clip?>(null) }
    var pendingRecord by remember { mutableStateOf<VoicePack.Clip?>(null) }
    val scope = rememberCoroutineScope()
    var guided by remember { mutableStateOf(false) }
    var pendingGuided by remember { mutableStateOf(false) }

    fun startRec(c: VoicePack.Clip) {
        runCatching {
            actions.container.wake.useMic("voicepack", true)
            pack.startRecording(c)
            recording = c
        }.onFailure {
            actions.container.wake.useMic("voicepack", false)
            actions.toast("Gagal merekam: ${it.message}")
        }
    }

    fun stopRec() {
        pack.stopRecording(save = true)
        recording = null
        actions.container.wake.useMic("voicepack", false)
    }

    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val c = pendingRecord
        pendingRecord = null
        if (ok && pendingGuided) guided = true
        pendingGuided = false
        if (ok && c != null) startRec(c) else if (!ok) actions.toast("Izin mikrofon dibutuhkan untuk merekam")
    }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val r = runCatching { withContext(Dispatchers.IO) { pack.importZip(uri) } }
            actions.toast(r.fold({ "$it klip suara terpasang" }, { it.message ?: "Gagal mengimpor paket suara" }))
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            if (recording != null) stopRec()
            pack.stop()
        }
    }

    LazyColumn(Modifier.fillMaxSize().statusBarsPadding(), contentPadding = PaddingValues(bottom = LocalBottomInset.current + 24.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { actions.nav.popBackStack() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Kembali") }
                Text("Suara Dev (Kodok-Kejepit)", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = { importer.launch(arrayOf("application/zip", "application/octet-stream", "*/*")) }) {
                    Icon(Icons.Rounded.FileOpen, "Impor paket .zip")
                }
            }
            Text(
                "Rekam semua sekaligus",
                color = Freease.accent.primary, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(10.dp))
                    .background(Freease.colors.card).clickable(enabled = recording == null) {
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) guided = true
                        else { pendingGuided = true; mic.launch(Manifest.permission.RECORD_AUDIO) }
                    }.padding(horizontal = 14.dp, vertical = 10.dp),
            )
            Text(
                "Asisten Freease menjawab dengan suara asli Kodok-Kejepit, bukan suara robot. Klip bisa ditimpa rekaman baru " +
                    "(maks. 6 detik) atau paket .zip. Jawaban tanpa klip khusus memakai klip \"Siap / oke\"; teksnya tetap tampil di layar.",
                style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }
        items(VoicePack.Clip.entries, key = { it.name }) { c ->
            val own = c in clips
            val has = own || c in pack.builtIn
            val rec = recording == c
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 5.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp))
                    .background(Freease.colors.card).padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(c.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Text(
                        if (rec) "Merekam… ketuk tombol stop kalau sudah" else "\"${c.suggestion}\"" + when {
                            own -> " · rekaman sendiri"
                            has -> " · bawaan"
                            else -> " · belum ada (pakai klip oke)"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (rec) Color(0xFFFF6B6B) else Freease.colors.muted,
                    )
                }
                if (has && !rec) {
                    IconButton(onClick = { pack.play(c) }) { Icon(Icons.Rounded.PlayArrow, "Dengarkan") }
                    if (own) IconButton(onClick = { pack.delete(c) }) { Icon(Icons.Rounded.DeleteOutline, "Hapus rekaman sendiri", tint = Freease.colors.muted) }
                }
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(if (rec) Color(0xFFFF4D4D) else Freease.colors.elevated)
                        .clickable(enabled = recording == null || rec) {
                            when {
                                rec -> stopRec()
                                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> startRec(c)
                                else -> { pendingRecord = c; mic.launch(Manifest.permission.RECORD_AUDIO) }
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(if (rec) Icons.Rounded.Stop else Icons.Rounded.FiberManualRecord, if (rec) "Selesai" else "Rekam", tint = if (rec) Color.White else Color(0xFFFF4D4D))
                }
                Spacer(Modifier.width(4.dp))
            }
        }
        if (clips.isNotEmpty()) {
            item {
                Text(
                    "Hapus semua rekaman sendiri (kembali ke suara bawaan)", color = Color(0xFFFF6B6B),
                    modifier = Modifier.padding(16.dp).clip(RoundedCornerShape(8.dp)).clickable { pack.clear() }.padding(8.dp),
                )
            }
        }
    }
    if (guided) GuidedRecordDialog(pack) { guided = false }
}

/**
 * Rekam semua jawaban berurutan: kalimat tampil, langsung merekam, berhenti sendiri ±0,9 dtk setelah
 * selesai bicara (maks. 6 dtk), lalu pindah ke kalimat berikutnya.
 */
@Composable
private fun GuidedRecordDialog(pack: VoicePack, onDone: () -> Unit) {
    val actions = LocalActions.current
    val clips = VoicePack.Clip.entries
    var index by remember { mutableIntStateOf(0) }
    var level by remember { mutableFloatStateOf(0f) }
    var saved by remember { mutableIntStateOf(0) }
    var attempt by remember { mutableIntStateOf(0) }
    val clip = clips.getOrNull(index)
    DisposableEffect(Unit) {
        actions.container.wake.useMic("voicepack", true)
        onDispose {
            pack.stopRecording(save = false)
            actions.container.wake.useMic("voicepack", false)
        }
    }
    LaunchedEffect(index, attempt) {
        val c = clip ?: return@LaunchedEffect
        kotlinx.coroutines.delay(600) // jeda sebentar supaya sempat membaca kalimatnya
        runCatching { pack.startRecording(c) }.onFailure { actions.toast("Gagal merekam: ${it.message}"); onDone(); return@LaunchedEffect }
        pack.amplitude()
        var heard = false
        var quietMs = 0
        var elapsed = 0
        while (elapsed < 6_000) {
            kotlinx.coroutines.delay(100)
            elapsed += 100
            val a = pack.amplitude()
            level = (a / 12_000f).coerceIn(0f, 1f)
            if (a > 2_500) { heard = true; quietMs = 0 } else if (heard) quietMs += 100
            if (heard && quietMs >= 900) break
            if (!heard && elapsed >= 5_000) break
        }
        pack.stopRecording(save = heard)
        level = 0f
        if (heard) saved++
        index++
    }
    AlertDialog(
        onDismissRequest = {},
        containerColor = Freease.colors.elevated,
        title = { Text(if (clip == null) "Selesai!" else "Kalimat ${index + 1} dari ${clips.size}") },
        text = {
            Column {
                if (clip == null) {
                    Text("$saved klip suara tersimpan. Asisten sekarang menjawab dengan suaramu.")
                } else {
                    Text(clip.label, style = MaterialTheme.typography.labelMedium, color = Freease.colors.muted)
                    Text("\"${clip.suggestion}\"", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(vertical = 10.dp))
                    Text("Ucapkan sekarang — berhenti sendiri setelah kamu selesai.", style = MaterialTheme.typography.bodySmall, color = Freease.colors.muted)
                    androidx.compose.material3.LinearProgressIndicator(
                        progress = { level }, modifier = Modifier.padding(top = 12.dp).fillMaxWidth(),
                        color = Color(0xFFFF4D4D),
                    )
                }
            }
        },
        confirmButton = {
            if (clip == null) TextButton(onClick = onDone) { Text("Tutup") }
            else TextButton(onClick = { pack.stopRecording(save = false); index++ }) { Text("Lewati") }
        },
        dismissButton = {
            if (clip != null) Row {
                TextButton(onClick = { pack.stopRecording(save = false); attempt++ }) { Text("Ulangi") }
                TextButton(onClick = onDone) { Text("Berhenti") }
            }
        },
    )
}
