package com.freease.music.assistant

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.media3.common.util.UnstableApi
import com.freease.music.ui.navigation.LocalActions
import com.freease.music.ui.theme.Freease
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed interface AsstState {
    data object Idle : AsstState
    data object Listening : AsstState
    data class Working(val heard: String) : AsstState
    data class Answer(val heard: String, val reply: String) : AsstState
    data class Problem(val message: String) : AsstState
}

private val Suggestions = listOf(
    "Putar lagu yang disukai", "Lagu apa ini?", "Lagu berikutnya", "Nyalakan karaoke",
    "Timer tidur 30 menit", "Putar Daily Mix", "Terjemahkan lirik", "Lagu apa yang diputar?",
)

/** Asisten Freease: ketuk/buka → langsung mendengarkan → perintah dijalankan → jawaban teks & suara. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun AssistantSheet(wake: Boolean = false, onDismiss: () -> Unit) {
    val actions = LocalActions.current
    val c = actions.container
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<AsstState>(AsstState.Idle) }
    var partial by remember { mutableStateOf("") }
    var micLevel by remember { mutableFloatStateOf(0f) }
    var closeJob by remember { mutableStateOf<Job?>(null) }
    val listener = remember { SpeechListener(context, c.asr) }
    val voice = remember { AssistantVoice(context) { speaking -> c.assistantDuck.value = speaking } }
    val executor = remember { AssistantExecutor(actions) }
    val pack = c.voicePack

    /** Ucapkan jawaban: klip suara sendiri, suara HP, atau diam — sesuai pengaturan. */
    fun respond(reply: Reply) {
        when (c.settings.current.replyVoice) {
            "off" -> c.assistantDuck.value = false
            "tts" -> voice.speak(reply.text)
            else -> {
                c.assistantDuck.value = true
                val played = pack.play(reply.clip) { c.assistantDuck.value = false }
                if (!played) voice.speak(reply.text)
            }
        }
    }

    fun handle(text: String) {
        val cmd = VoiceParser.parse(text, preferPlay = wake)
        if (cmd == null) {
            val r = Reply("Sorry bro, gua belum ngerti. Coba bilang \"putar\" terus judul lagunya.", VoicePack.Clip.NOT_UNDERSTOOD, ok = false)
            state = AsstState.Answer(text, r.text)
            respond(r)
            return
        }
        state = AsstState.Working(text)
        scope.launch {
            val reply = runCatching { executor.run(cmd) }
                .getOrElse { Reply("Ada masalah: ${it.message ?: "coba lagi"}", VoicePack.Clip.NOT_UNDERSTOOD, ok = false) }
            state = AsstState.Answer(text, reply.text)
            respond(reply)
            // Perintah yang selesai dijalankan: tutup sendiri supaya tidak menghalangi.
            if (cmd !is VoiceCommand.Help && cmd !is VoiceCommand.WhatsPlaying && cmd !is VoiceCommand.Summary) {
                // Pindah halaman: tutup lebih cepat supaya halamannya langsung terlihat.
                val navigation = cmd is VoiceCommand.Open || cmd is VoiceCommand.OpenPlaylist || cmd is VoiceCommand.OpenDailyMix ||
                    cmd is VoiceCommand.OpenWrapped || cmd is VoiceCommand.OpenArtist || cmd is VoiceCommand.Back
                closeJob = scope.launch { delay(if (navigation && reply.ok) 1_200 else 2_600); onDismiss() }
            }
        }
    }

    fun listen() {
        closeJob?.cancel()
        if (!listener.available) {
            state = AsstState.Problem("Pengenal suara tidak tersedia di HP ini. Pasang/aktifkan aplikasi Google.")
            return
        }
        partial = ""
        state = AsstState.Listening
        c.assistantDuck.value = true
        listener.start(offline = !c.isOnline(), cb = object : SpeechListener.Callback {
            override fun onLevel(level: Float) { micLevel = level }
            override fun onPartial(text: String) { partial = text }
            override fun onResult(text: String) { partial = text; handle(text) }
            override fun onError(message: String) {
                state = AsstState.Problem(message)
                c.assistantDuck.value = false
            }
        })
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) listen() else state = AsstState.Problem("Izin mikrofon dibutuhkan untuk perintah suara.")
    }

    fun tapMic() {
        if (state == AsstState.Listening) {
            listener.stop()
            state = AsstState.Idle
            c.assistantDuck.value = false
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) listen()
        else permission.launch(Manifest.permission.RECORD_AUDIO)
    }

    LaunchedEffect(Unit) {
        if (wake) {
            // Tanda "aku siap" yang pendek & pelan — perintah bisa langsung diucapkan.
            runCatching {
                android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC, 35).startTone(android.media.ToneGenerator.TONE_PROP_ACK, 120)
            }
        }
        tapMic()
    }
    DisposableEffect(Unit) {
        c.wake.useMic("assistant", true)
        onDispose {
            listener.stop()
            c.asr.releaseAsync()
            pack.stop()
            voice.shutdown()
            c.assistantDuck.value = false
            c.wake.useMic("assistant", false)
        }
    }

    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Freease.colors.elevated) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Asisten Freease", style = MaterialTheme.typography.labelLarge, color = Freease.colors.muted)
            Spacer(Modifier.height(10.dp))
            val (headline, sub) = when (val s = state) {
                AsstState.Idle -> "Ketuk mikrofon" to "lalu ucapkan perintahmu"
                AsstState.Listening -> (partial.ifBlank { "Aku mendengarkan…" }) to (if (partial.isBlank()) "Coba: \"putar Tulus\"" else "")
                is AsstState.Working -> "\"${s.heard}\"" to "Sebentar…"
                is AsstState.Answer -> s.reply to "\"${s.heard}\""
                is AsstState.Problem -> s.message to "Ketuk mikrofon untuk mencoba lagi"
            }
            Text(
                headline, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
            if (sub.isNotEmpty()) {
                Text(sub, style = MaterialTheme.typography.bodyMedium, color = Freease.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(18.dp))
            MicButton(listening = state == AsstState.Listening, level = micLevel, onClick = ::tapMic)
            Spacer(Modifier.height(18.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Suggestions.forEach { s ->
                    Text(
                        s, style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.clip(CircleShape).background(Freease.colors.card).clickable {
                            listener.stop()
                            handle(s)
                        }.padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MicButton(listening: Boolean, level: Float, onClick: () -> Unit) {
    val accent = Freease.accent.primary
    val pulse = rememberInfiniteTransition(label = "asst")
    val ring by pulse.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "ring")
    val lvl by animateFloatAsState(if (listening) level else 0f, tween(100), label = "lvl")
    Box(Modifier.size(150.dp), contentAlignment = Alignment.Center) {
        if (listening) {
            Canvas(Modifier.fillMaxSize()) {
                for (k in 0 until 2) {
                    val f = (ring + k / 2f) % 1f
                    drawCircle(accent.copy(alpha = (1f - f) * 0.5f), radius = size.minDimension / 2 * (0.6f + 0.4f * f), style = Stroke(3.dp.toPx()))
                }
            }
        }
        Box(
            Modifier.size((84 + 18 * lvl).dp).clip(CircleShape).background(accent).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { Icon(if (listening) Icons.Rounded.GraphicEq else Icons.Rounded.Mic, "Bicara", tint = Color.Black, modifier = Modifier.size(40.dp)) }
    }
}
