package com.freease.music.assistant

import android.media.AudioManager
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.freease.music.data.lyrics.LyricsMatch
import com.freease.music.playback.LibraryTree
import com.freease.music.ui.navigation.AppActions
import com.freease.music.ui.navigation.Routes
import kotlinx.coroutines.flow.first

/** Jawaban asisten: [text] ditampilkan (dan dibacakan suara HP), [clip] = klip suara sendiri yang cocok. */
data class Reply(val text: String, val clip: VoicePack.Clip, val ok: Boolean = true)

/** Menjalankan [VoiceCommand] dan mengembalikan jawaban singkat untuk ditampilkan/diucapkan. */
@UnstableApi
class AssistantExecutor(private val actions: AppActions) {
    private val c get() = actions.container

    suspend fun run(cmd: VoiceCommand): Reply {
        val text = runText(cmd)
        val failed = text.startsWith("Sorry") || text.startsWith("Belum ada") || text.contains("nggak ada") || text.contains("nggak ketemu")
        val clip = when {
            failed && text.contains("ketemu") -> VoicePack.Clip.NOT_FOUND
            failed -> VoicePack.Clip.NOT_UNDERSTOOD
            else -> when (cmd) {
                is VoiceCommand.Play, is VoiceCommand.PlayPlaylist, VoiceCommand.PlayLiked, is VoiceCommand.PlayDailyMix,
                VoiceCommand.More, VoiceCommand.Again, is VoiceCommand.PlayMood -> VoicePack.Clip.PLAY
                VoiceCommand.PlayDownloads -> VoicePack.Clip.DOWNLOADS
                is VoiceCommand.Search, VoiceCommand.Recognize -> VoicePack.Clip.SEARCH
                VoiceCommand.Pause -> VoicePack.Clip.PAUSE
                VoiceCommand.Next -> VoicePack.Clip.NEXT
                is VoiceCommand.Karaoke -> if (cmd.on) VoicePack.Clip.KARAOKE else VoicePack.Clip.ACK
                is VoiceCommand.SleepTimer -> VoicePack.Clip.SLEEP
                VoiceCommand.Help -> VoicePack.Clip.INTRO
                else -> VoicePack.Clip.ACK
            }
        }
        return Reply(text, clip, ok = !failed)
    }

    private suspend fun runText(cmd: VoiceCommand): String {
        val player = actions.player
        val now = player.state.value.song
        return when (cmd) {
            is VoiceCommand.Play -> {
                val songs = c.voiceQueue(cmd.query)
                if (songs.isEmpty()) return "Sorry, \"${cmd.query}\" nggak ketemu."
                memory.remember(cmd.query, null, songs.take(1), now)
                player.play(songs, from = "Asisten: ${cmd.query}")
                val top = songs.first()
                "Siap, gua puterin ${top.title} dari ${top.artist}."
            }
            is VoiceCommand.PlayMood -> playMood(cmd.mood, more = false)
            VoiceCommand.More -> {
                val mood = memory.lastMood.takeIf { memory.fresh }
                val query = memory.lastQuery.takeIf { memory.fresh }
                when {
                    mood != null -> playMood(mood, more = true)
                    query != null -> {
                        val songs = c.voiceQueue(query).filterNot { memory.alreadyPlayed(it.id) || it.id == now?.id }
                        if (songs.isEmpty()) return "Sorry, yang lain buat \"$query\" nggak ketemu."
                        memory.remember(query, null, songs.take(1), now)
                        player.play(songs, from = "Asisten: $query")
                        "Oke, yang lain: ${songs.first().title} dari ${songs.first().artist}."
                    }
                    now != null -> {
                        memory.remember(null, null, emptyList(), now)
                        player.startRadio(now, "Mirip ${now.title}")
                        "Oke, gua puterin lagu-lagu yang mirip ${now.title}."
                    }
                    else -> "Belum ada lagu yang diputer. Coba bilang \"putar\" terus judul lagunya."
                }
            }
            VoiceCommand.Again -> {
                val prev = memory.previousSong?.takeIf { it.id != now?.id }
                when {
                    prev != null -> {
                        memory.remember(null, null, listOf(prev), now)
                        player.play(listOf(prev), from = "Asisten")
                        "Siap, gua puterin lagi ${prev.title}."
                    }
                    player.state.value.hasPrevious -> { player.previous(); "Siap, balik ke lagu yang tadi." }
                    else -> "Sorry, belum ada lagu sebelumnya, nggak ketemu yang tadi."
                }
            }
            is VoiceCommand.Summary -> summary(cmd.days)
            is VoiceCommand.Search -> {
                actions.searchFor(cmd.query)
                "Nanti gua cariin \"${cmd.query}\"."
            }
            is VoiceCommand.PlayPlaylist -> {
                val lists = c.library.playlistSummaries().first()
                val p = lists.firstOrNull { it.name.equals(cmd.name, ignoreCase = true) }
                    ?: lists.firstOrNull { LyricsMatch.coverage(cmd.name, it.name) >= 0.6 || it.name.lowercase().contains(cmd.name) }
                    ?: return "Sorry, playlist \"${cmd.name}\" nggak ketemu di koleksi lu."
                val songs = c.library.playlistSongs(p.id).first()
                if (songs.isEmpty()) return "Sorry, playlist ${p.name} masih kosong."
                memory.remember(null, null, songs.take(1), now)
                player.play(songs, from = p.name)
                "Gua puterin playlist ${p.name}."
            }
            VoiceCommand.PlayLiked -> {
                val songs = c.library.likedSongs()
                if (songs.isEmpty()) return "Belum ada lagu yang lu sukai."
                player.play(songs, shuffle = true, from = "Lagu yang Disukai")
                "Gua puterin lagu-lagu kesukaan lu, diacak."
            }
            VoiceCommand.PlayDownloads -> {
                val songs = LibraryTree(c).songsOf(LibraryTree.DOWNLOADS)
                if (songs.isEmpty()) return "Belum ada lagu yang lu download."
                player.play(songs, shuffle = true, from = "Unduhan")
                actions.navigate(Routes.DOWNLOADS)
                "Gua puterin ${songs.size} lagu yang udah lu download."
            }
            is VoiceCommand.PlayDailyMix -> {
                c.dailyMix.ensureFresh()
                val mix = c.dailyMix.mixes.value.getOrNull(cmd.number - 1)
                    ?: return "Sorry, Daily Mix ${cmd.number} belum ada. Dengerin lebih banyak lagu dulu, ya."
                player.play(mix.songs, from = mix.title)
                "Gua puterin ${mix.title}: ${mix.subtitle}."
            }
            VoiceCommand.Next -> if (!player.hasQueue()) nothing() else { player.next(); "Lanjut lagu berikutnya." }
            VoiceCommand.Previous -> if (!player.hasQueue()) nothing() else { player.previous(); "Lagu sebelumnya." }
            VoiceCommand.Pause -> { player.pause(); "Oke, gua jeda dulu." }
            VoiceCommand.Resume -> if (!player.hasQueue()) nothing() else { player.resume(); "Lanjut!" }
            VoiceCommand.Like -> {
                val s = now ?: return nothing()
                c.library.setLiked(s, true)
                "${s.title} udah gua masukin ke lagu kesukaan lu."
            }
            is VoiceCommand.Shuffle -> {
                val on = cmd.on ?: !player.state.value.shuffle
                player.setShuffle(on)
                if (on) "Mode acak menyala." else "Mode acak dimatikan."
            }
            VoiceCommand.Repeat -> { player.setRepeat(Player.REPEAT_MODE_ONE); "Oke, lagu ini gua ulang terus." }
            is VoiceCommand.Karaoke -> {
                val active = c.karaokeMode.value
                when {
                    cmd.on && active -> "Mode Karaoke sudah menyala."
                    cmd.on -> { actions.toggleKaraoke(); "Karaoke nyala, gas nyanyi!" }
                    active -> { c.karaokeMode.value = false; "Mode Karaoke dimatikan." }
                    else -> "Mode Karaoke memang sedang mati."
                }
            }
            VoiceCommand.ShowLyrics -> {
                if (now == null) return nothing()
                actions.playerExpanded = true
                actions.showLyrics = true
                "Nih liriknya."
            }
            VoiceCommand.TranslateLyrics -> {
                c.settings.setTranslateLyrics(true)
                if (now != null) { actions.playerExpanded = true; actions.showLyrics = true }
                "Terjemahan lirik menyala."
            }
            is VoiceCommand.SleepTimer -> {
                c.sleepTimer.start(cmd.minutes)
                "Siap, musiknya gua matiin dalam ${duration(cmd.minutes)}."
            }
            VoiceCommand.CancelSleep -> { c.sleepTimer.cancel(); "Timer tidur dibatalkan." }
            VoiceCommand.Recognize -> {
                actions.navigate(Routes.recognize(auto = true))
                "Bentar, gua dengerin lagunya…"
            }
            VoiceCommand.WhatsPlaying -> now?.let { "Ini ${it.title} dari ${it.artist}." } ?: "Belum ada lagu yang diputer."
            is VoiceCommand.Volume -> {
                val am = actions.context.getSystemService(AudioManager::class.java)
                repeat(2) {
                    am?.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (cmd.up) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
                }
                if (cmd.up) "Volume dinaikkan." else "Volume diturunkan."
            }
            is VoiceCommand.Open -> openPage(cmd.page)
            is VoiceCommand.OpenPlaylist -> {
                val lists = c.library.playlistSummaries().first()
                val p = lists.firstOrNull { it.name.equals(cmd.name, ignoreCase = true) }
                    ?: lists.firstOrNull { LyricsMatch.coverage(cmd.name, it.name) >= 0.6 || it.name.lowercase().contains(cmd.name) }
                    ?: return "Sorry, playlist \"${cmd.name}\" nggak ketemu di koleksi lu."
                actions.openLocal(p.id)
                "Nih playlist ${p.name}."
            }
            is VoiceCommand.OpenDailyMix -> {
                c.dailyMix.ensureFresh()
                val mix = c.dailyMix.mixes.value.getOrNull(cmd.number - 1)
                    ?: return "Sorry, Daily Mix ${cmd.number} belum ada. Dengerin lebih banyak lagu dulu, ya."
                actions.navigate(Routes.mix(mix.index))
                "Nih ${mix.title}."
            }
            is VoiceCommand.OpenWrapped -> {
                val year = cmd.year ?: com.freease.music.ui.screens.defaultWrappedYear()
                actions.navigate(Routes.wrapped(year))
                "Nih rekap tahunan lu, $year."
            }
            is VoiceCommand.OpenArtist -> {
                val artist = runCatching {
                    c.youtube.search(cmd.name, com.freease.music.data.youtube.SearchFilter.ARTISTS).items
                        .filterIsInstance<com.freease.music.data.model.BrowseResult.ArtistResult>().firstOrNull()?.artist
                }.getOrNull()
                if (artist == null) {
                    actions.searchFor(cmd.name)
                    "Gua cariin artis ${cmd.name}."
                } else {
                    actions.openArtist(artist.url)
                    "Nih halaman ${artist.name}."
                }
            }
            VoiceCommand.Back -> {
                when {
                    actions.showQueue -> actions.showQueue = false
                    actions.showLyrics -> actions.showLyrics = false
                    actions.playerExpanded -> actions.playerExpanded = false
                    else -> actions.nav.popBackStack()
                }
                "Oke, balik."
            }
            VoiceCommand.Help ->
                "Gua Freease, asisten pribadi lu. Bilang aja: putar Tulus, yang lain dong, lagu buat belajar, aku dengerin apa aja hari ini, " +
                    "lagu berikutnya, putar lagu yang udah didownload, " +
                    "buka koleksi, buka karaoke tersimpan, buka rekap tahunan, lagu apa ini, nyalain karaoke, atau timer tidur tiga puluh menit."
        }
    }

    private fun openPage(page: Page): String {
        when (page) {
            Page.HOME -> actions.openTab(Routes.HOME)
            Page.SEARCH -> actions.openTab(Routes.SEARCH)
            Page.LIBRARY -> actions.openTab(Routes.LIBRARY)
            Page.LIKED -> actions.navigate(Routes.LIKED)
            Page.DOWNLOADS -> actions.navigate(Routes.DOWNLOADS)
            Page.KARAOKE_SAVED -> actions.navigate(Routes.KARAOKE_SAVED)
            Page.LOCAL_MUSIC -> actions.navigate(Routes.LOCAL_MUSIC)
            Page.HISTORY -> actions.navigate(Routes.HISTORY)
            Page.STATS -> actions.navigate(Routes.STATS)
            Page.MONTHLY -> actions.navigate(Routes.MONTHLY)
            Page.SETTINGS -> actions.navigate(Routes.SETTINGS)
            Page.EQUALIZER -> actions.navigate(Routes.EQUALIZER)
            Page.ALARMS -> actions.navigate(Routes.ALARMS)
            Page.CAR -> actions.navigate(Routes.CAR)
            Page.RECOGNIZE -> actions.navigate(Routes.recognize(auto = false))
            Page.IMPORT -> actions.navigate(Routes.import())
            Page.VOICE_PACK -> actions.navigate(Routes.VOICE_PACK)
            Page.PLAYER, Page.QUEUE -> {
                if (actions.player.state.value.song == null) return nothing()
                actions.showLyrics = false
                actions.playerExpanded = true
                if (page == Page.QUEUE) actions.showQueue = true
            }
        }
        return "Oke, gua bukain ${page.label}."
    }

    private val memory get() = c.assistantMemory

    /** Lagu sesuai suasana: hasil pencarian suasana + lagu kesukaan yang cocok, dicampur. */
    private suspend fun playMood(mood: MoodKind, more: Boolean): String {
        val now = actions.player.state.value.song
        val online = if (c.isOnline()) runCatching { c.youtube.searchSongs(mood.query, 30) }.getOrDefault(emptyList()) else emptyList()
        val local = runCatching { c.library.searchLocal(mood.label) }.getOrDefault(emptyList())
        var songs = (online + local).distinctBy { it.id }
        if (more) songs = songs.filterNot { memory.alreadyPlayed(it.id) }
        if (songs.isEmpty() && !c.isOnline()) {
            // Offline: pakai unduhan diacak.
            songs = com.freease.music.playback.LibraryTree(c).songsOf(com.freease.music.playback.LibraryTree.DOWNLOADS)
        }
        if (songs.isEmpty()) return "Sorry, lagu buat ${mood.label} nggak ketemu."
        songs = songs.shuffled().take(40)
        memory.remember(null, mood, songs, now)
        actions.player.play(songs, from = "Asisten: lagu ${mood.label}")
        return if (more) "Oke, lagu ${mood.label} yang lain. Mulai dari ${songs.first().title}."
        else "Siap, gua puterin lagu buat ${mood.label}. Mulai dari ${songs.first().title}."
    }

    /** "Hari ini lu dengerin 2 jam, paling sering …" */
    private suspend fun summary(days: Int): String {
        val cal = java.util.Calendar.getInstance()
        if (days <= 1) {
            cal.set(java.util.Calendar.HOUR_OF_DAY, 0); cal.set(java.util.Calendar.MINUTE, 0)
            cal.set(java.util.Calendar.SECOND, 0); cal.set(java.util.Calendar.MILLISECOND, 0)
        } else {
            cal.add(java.util.Calendar.DAY_OF_YEAR, -days)
        }
        val since = cal.timeInMillis
        val total = c.library.totalMs(since).first()
        val period = when (days) { 1 -> "Hari ini"; 7 -> "Seminggu ini"; else -> "Sebulan ini" }
        if (total < 60_000) return "$period lu belum dengerin apa-apa. Yuk, putar sesuatu!"
        val top = c.library.topSongs(since, 3).first()
        val artist = c.library.topArtists(since, 1).first().firstOrNull()
        val sb = StringBuilder("$period lu dengerin ${listenTime(total)}")
        top.firstOrNull()?.let { sb.append(", paling sering ${it.song.title} (${it.plays}×)") }
        artist?.let { sb.append(", artis favorit ${it.artist}") }
        sb.append(".")
        if (top.size > 1) sb.append(" Disusul ${top.drop(1).joinToString(" dan ") { it.song.title }}.")
        return sb.toString()
    }

    private fun listenTime(ms: Long): String {
        val min = (ms / 60_000).toInt()
        return when {
            min >= 60 && min % 60 == 0 -> "${min / 60} jam"
            min >= 60 -> "${min / 60} jam ${min % 60} menit"
            else -> "$min menit"
        }
    }

    private fun nothing() = "Belum ada lagu yang diputer."

    private fun duration(min: Int) = when {
        min % 60 == 0 -> "${min / 60} jam"
        min > 60 -> "${min / 60} jam ${min % 60} menit"
        else -> "$min menit"
    }
}
