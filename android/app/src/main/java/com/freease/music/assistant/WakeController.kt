package com.freease.music.assistant

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.freease.music.data.prefs.SettingsRepository
import com.freease.music.karaoke.ModelState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

/**
 * Menyalakan pendengar "Oke Freease" hanya saat semuanya terpenuhi: fitur aktif, aplikasi sedang
 * terbuka, model siap, izin mikrofon ada, dan mikrofon tidak sedang dipakai (asisten, Kenali Lagu).
 */
class WakeController(private val context: Context, settings: SettingsRepository, client: OkHttpClient, scope: CoroutineScope) {
    val model = WakeModel(context, client, scope)

    /** Aplikasi terlihat di layar (diisi MainActivity). */
    val foreground = MutableStateFlow(false)

    /** Pemakai mikrofon lain yang sedang aktif; selama tidak kosong, pendengar berhenti. */
    val micUsers = MutableStateFlow<Set<String>>(emptySet())

    private val _wakes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Terpancar setiap "Oke Freease" terdengar. */
    val wakes: SharedFlow<Unit> = _wakes

    // Setelah terpicu, pendengar melepas mikrofon sendiri; asisten yang terbuka menandai mikrofon dipakai,
    // dan saat asisten ditutup kondisi berubah lagi sehingga pendengar menyala kembali.
    private val listener = WakeWordListener(model) { _wakes.tryEmit(Unit) }

    fun useMic(who: String, using: Boolean) {
        micUsers.value = if (using) micUsers.value + who else micUsers.value - who
    }

    init {
        scope.launch(Dispatchers.Main) {
            combine(settings.flow.map { it.wakeWord }, foreground, micUsers, model.state) { on, fg, users, st ->
                on && fg && users.isEmpty() && st is ModelState.Ready &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            }.distinctUntilChanged().collect { want ->
                if (want) listener.start() else listener.stop()
            }
        }
        // Aplikasi di latar > 2 menit → lepaskan model (±50 MB RAM); dimuat lagi (±1 dtk) saat app dibuka.
        // Di thread utama, berurutan dengan start/stop pendengar di atas → tidak pernah melepas model yang sedang dipakai.
        scope.launch(Dispatchers.Main) {
            foreground.collectLatest { fg ->
                if (!fg) {
                    kotlinx.coroutines.delay(120_000)
                    if (!listener.isRunning) model.release()
                }
            }
        }
        // Fitur dimatikan → lepaskan memori model.
        scope.launch {
            settings.flow.map { it.wakeWord }.distinctUntilChanged().collect { if (!it) model.release() }
        }
    }
}
