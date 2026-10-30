package com.freease.music.assistant

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Mendengarkan satu perintah bahasa Indonesia. Online memakai pengenal suara HP (Google); tanpa internet
 * memakai pengenal offline Freease ([asr]) bila modelnya sudah diunduh. Wajib dipakai dari thread utama.
 */
class SpeechListener(private val context: Context, private val asr: OfflineAsr? = null) {
    interface Callback {
        fun onReady() {}
        fun onLevel(level: Float) {}
        fun onPartial(text: String) {}
        fun onResult(text: String)
        fun onError(message: String)
    }

    private var recognizer: SpeechRecognizer? = null

    private val offlineListener by lazy { asr?.let(::OfflineListener) }

    val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context) || asr?.ready() == true

    /**
     * [offline]: tidak ada internet → pengenal offline Freease bila siap; kalau belum, pengenal di perangkat
     * (Android 13+) atau mode offline Google.
     */
    fun start(cb: Callback, offline: Boolean = false) {
        stop()
        if ((offline || !SpeechRecognizer.isRecognitionAvailable(context)) && asr?.ready() == true) {
            offlineListener?.start(cb)
            return
        }
        val onDevice = offline && android.os.Build.VERSION.SDK_INT >= 33 && runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }.getOrDefault(false)
        val r = if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
        this.offline = offline
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = cb.onReady()
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) = cb.onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) = cb.onError(message(error))
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (text.isNullOrBlank()) cb.onError("Tidak ada suara yang terdengar") else cb.onResult(text)
            }
            override fun onPartialResults(partial: Bundle?) {
                partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let(cb::onPartial)
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "id-ID")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline),
        )
    }

    private var offline = false

    fun stop() {
        offlineListener?.stop()
        recognizer?.run { runCatching { cancel() }; destroy() }
        recognizer = null
    }

    private fun message(code: Int) = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Tidak ada suara yang terdengar"
        13 /* ERROR_LANGUAGE_NOT_SUPPORTED */, 14 /* ERROR_LANGUAGE_UNAVAILABLE */ ->
            "Pengenal suara offline belum ada. Unduh di Pengaturan → Asisten Freease → Pengenal suara offline."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
            if (offline) "Lagi offline. Unduh pengenal suara offline dulu (Pengaturan → Asisten Freease) supaya perintah tetap jalan tanpa internet."
            else "Pengenal suara butuh internet"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Izin mikrofon dibutuhkan"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Mikrofon sedang dipakai, coba lagi"
        SpeechRecognizer.ERROR_AUDIO -> "Mikrofon bermasalah"
        else -> "Gagal mendengarkan (kode $code)"
    }
}

/** Suara jawaban asisten (TTS bawaan HP, bahasa Indonesia). */
class AssistantVoice(context: Context, private val onSpeaking: (Boolean) -> Unit) {
    private var ready = false
    private var pending: String? = null
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            tts.language = Locale("id", "ID")
            // Suara Indonesia berkualitas tertinggi; yang tidak butuh internet didahulukan bila mutunya setara.
            runCatching {
                tts.voices?.filter { it.locale.language == "id" && !it.features.contains("notInstalled") }
                    ?.maxWithOrNull(compareBy({ it.quality }, { !it.isNetworkConnectionRequired }))
                    ?.let { tts.voice = it }
            }
            tts.setSpeechRate(1.05f)
            tts.setPitch(1.0f)
            tts.setAudioAttributes(
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) = onSpeaking(true)
                override fun onDone(id: String?) = onSpeaking(false)
                @Deprecated("Deprecated in Java")
                override fun onError(id: String?) = onSpeaking(false)
            })
            pending?.let { speak(it) }
            pending = null
        }
    }

    fun speak(text: String) {
        if (!ready) {
            pending = text
            return
        }
        // Volume 0,55: suara bawaan TTS cenderung jauh lebih keras dari musik.
        val params = android.os.Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 0.55f) }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "freease")
    }

    fun shutdown() {
        runCatching { tts.stop(); tts.shutdown() }
    }
}
