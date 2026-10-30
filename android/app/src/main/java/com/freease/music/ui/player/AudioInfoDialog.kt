package com.freease.music.ui.player

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.delay
import java.util.Locale

/** "Info audio": dari mana suaranya datang dan bagaimana diolah — untuk yang penasaran. */
@Composable
fun AudioInfoDialog(songId: String, onDismiss: () -> Unit) {
    val actions = LocalActions.current
    val info by actions.container.audioInfo.collectAsState()
    var gain by remember { mutableDoubleStateOf(actions.container.audioGainDb()) }
    var lufs by remember { androidx.compose.runtime.mutableStateOf(actions.container.loudness.get(songId)) }
    LaunchedEffect(Unit) {
        while (true) {
            gain = actions.container.audioGainDb()
            lufs = actions.container.loudness.get(songId)
            delay(500)
        }
    }
    val i = info?.takeIf { it.songId == songId }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Freease.colors.elevated,
        title = { Text("Info audio") },
        text = {
            if (i == null) {
                Text("Info tersedia setelah lagu mulai diputar.", color = Freease.colors.muted)
            } else {
                Column {
                    InfoRow("Sumber", i.source)
                    InfoRow("Codec", i.codec ?: "—")
                    InfoRow("Bitrate", if (i.bitrateKbps > 0) "${i.bitrateKbps} kbps" else "—")
                    InfoRow("Sample rate", if (i.sampleRate > 0) String.format(Locale.US, "%.1f kHz", i.sampleRate / 1000.0) else "—")
                    InfoRow("Kanal", when (i.channels) { 1 -> "Mono"; 2 -> "Stereo"; 0, -1 -> "—"; else -> "${i.channels} kanal" })
                    HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Freease.colors.divider)
                    InfoRow("Loudness lagu", (i.loudnessLufs ?: lufs)?.let { String.format(Locale.US, "%.1f LUFS", it) } ?: "Sedang diukur…")
                    InfoRow("Normalisasi", i.targetLufs?.let { String.format(Locale.US, "ke %.0f LUFS", it) } ?: "Mati")
                    if (i.targetLufs != null) InfoRow("Penguatan", String.format(Locale.US, "%+.1f dB", gain))
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Tutup", color = Freease.accent.primary) } },
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, Modifier.weight(0.42f), color = Freease.colors.muted, style = MaterialTheme.typography.bodyMedium)
        Text(value, Modifier.weight(0.58f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}
