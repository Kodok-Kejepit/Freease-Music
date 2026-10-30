package com.freease.music.assistant

/** Perintah yang dipahami Asisten Freease. */
sealed interface VoiceCommand {
    data class Play(val query: String) : VoiceCommand
    data class Search(val query: String) : VoiceCommand
    data class PlayPlaylist(val name: String) : VoiceCommand
    data object PlayLiked : VoiceCommand
    data object PlayDownloads : VoiceCommand
    data class PlayDailyMix(val number: Int) : VoiceCommand
    data object Next : VoiceCommand
    data object Previous : VoiceCommand
    data object Pause : VoiceCommand
    data object Resume : VoiceCommand
    data object Like : VoiceCommand
    data class Shuffle(val on: Boolean?) : VoiceCommand
    data object Repeat : VoiceCommand
    data class Karaoke(val on: Boolean) : VoiceCommand
    data object ShowLyrics : VoiceCommand
    data object TranslateLyrics : VoiceCommand
    data class SleepTimer(val minutes: Int) : VoiceCommand
    data object CancelSleep : VoiceCommand
    data object Recognize : VoiceCommand
    data object WhatsPlaying : VoiceCommand
    data class Volume(val up: Boolean) : VoiceCommand
    data object Help : VoiceCommand

    /** Pindah ke halaman aplikasi ("buka beranda", "pergi ke koleksi", "buka rekap tahunan"). */
    data class Open(val page: Page) : VoiceCommand
    data class OpenPlaylist(val name: String) : VoiceCommand
    data class OpenDailyMix(val number: Int) : VoiceCommand
    data class OpenWrapped(val year: Int?) : VoiceCommand
    data class OpenArtist(val name: String) : VoiceCommand
    data object Back : VoiceCommand

    /** "yang lain dong" — lanjutan dari permintaan sebelumnya (pencarian/mood) atau radio lagu sekarang. */
    data object More : VoiceCommand
    /** "yang tadi lagi" — putar lagi lagu sebelumnya. */
    data object Again : VoiceCommand
    /** "putar lagu buat belajar", "lagu galau", "yang lebih santai". */
    data class PlayMood(val mood: MoodKind) : VoiceCommand
    /** "aku dengerin apa aja hari ini?" — rangkuman [days] hari terakhir (1 = hari ini). */
    data class Summary(val days: Int) : VoiceCommand
}

/** Suasana/aktivitas yang dipahami asisten; [query] = kata kunci pencarian lagunya. */
enum class MoodKind(val label: String, val words: String, val query: String) {
    STUDY("belajar", "belajar|fokus|kerja|ngoding|konsentrasi|nugas|tugas", "lagu fokus belajar lofi instrumental"),
    SAD("galau", "galau|sedih|patah hati|nangis|mellow|melow|baper", "lagu galau indonesia"),
    WORKOUT("olahraga", "olahraga|gym|lari|workout|fitness|semangat|nge-?gym|jogging", "lagu semangat workout"),
    SLEEP("tidur", "tidur|istirahat|rebahan|bobo|nina bobo", "musik tidur relaksasi tenang"),
    CHILL("santai", "santai|chill|kalem|ngopi|nyantai|selow", "lagu santai indonesia chill akustik"),
    ROMANCE("romantis", "romantis|cinta|bucin|pacar|jatuh cinta|kasmaran", "lagu romantis indonesia"),
    PARTY("pesta", "pesta|party|joget|goyang|dance|ajep|dugem", "lagu party dance hits"),
    DRIVE("perjalanan", "nyetir|perjalanan|road trip|mudik|jalan[- ]jalan|touring|di jalan", "lagu perjalanan road trip indonesia"),
    HAPPY("ceria", "ceria|happy|senang|bahagia|gembira|riang", "lagu ceria happy"),
    RELIGI("religi", "religi|ngaji|sholawat|shalawat|islami|rohani", "lagu religi islami"),
    ;

    companion object {
        fun find(text: String): MoodKind? = entries.firstOrNull { Regex("\\b(${it.words})\\b").containsMatchIn(text) }
    }
}

/** Halaman yang bisa dibuka lewat suara; [label] dipakai di jawaban asisten. */
enum class Page(val label: String) {
    HOME("Beranda"),
    SEARCH("Cari"),
    LIBRARY("Koleksi"),
    LIKED("Lagu yang Disukai"),
    DOWNLOADS("Unduhan"),
    KARAOKE_SAVED("Karaoke tersimpan"),
    LOCAL_MUSIC("Musik & video di HP"),
    HISTORY("Riwayat putar"),
    STATS("Statistik"),
    MONTHLY("Rekap bulanan"),
    SETTINGS("Pengaturan"),
    EQUALIZER("Equalizer"),
    ALARMS("Alarm musik"),
    CAR("Mode mobil"),
    RECOGNIZE("Kenali lagu"),
    IMPORT("Impor playlist"),
    VOICE_PACK("Suara Dev"),
    PLAYER("Pemutar"),
    QUEUE("Antrean"),
}

/**
 * Memahami ucapan bahasa Indonesia (dan sebagian Inggris) menjadi [VoiceCommand]. Sengaja berbasis
 * aturan: cepat, bekerja offline, dan mudah diperluas. Kalimat yang tidak dikenali dianggap pencarian.
 */
object VoiceParser {
    private val FILLER = Regex(
        "\\b(tolong|coba|dong|deh|ya|yah|yuk|ayo|please|hei|hai|halo|hallo|oke|okay|ok|freease|frease|frees|freeze|fries|fris|friis|freez|asisten|aku mau|saya mau|aku ingin|saya ingin|bisa|minta|sekarang)\\b",
    )
    private val NUMBER_WORDS = mapOf(
        "satu" to 1, "dua" to 2, "tiga" to 3, "empat" to 4, "lima" to 5, "enam" to 6, "tujuh" to 7,
        "delapan" to 8, "sembilan" to 9, "sepuluh" to 10, "lima belas" to 15, "dua puluh" to 20,
        "tiga puluh" to 30, "empat puluh" to 40, "empat puluh lima" to 45, "enam puluh" to 60, "setengah" to 30,
    )

    private const val OPEN_VERB =
        "(?:buka(?:kan|in)?|pergi(?: ke)?|ke|masuk(?: ke)?|tampilkan|tunjukkan|lihat(?:in)?|liat(?:in)?|menuju(?: ke)?|" +
            "pindah(?: ke)?|kembali ke|balik ke|open|go to|show|cek|check)"

    /** Nama-nama halaman (boleh diakhiri "nya/ku/saya"). Urutan penting: yang lebih spesifik dulu. */
    private val PAGES: List<Pair<Page, Regex>> = listOf(
        // "karaoke" saja = nyalakan Mode Karaoke; halaman butuh kata penjelas.
        Page.KARAOKE_SAVED to "(lagu[- ]?lagu |lagu |musik |hasil |daftar |koleksi )karaoke( yang)?( (sudah|udah|telah))?( (tersimpan|disimpan|di ?simpan|di ?download|diunduh|di ?unduh|offline))?|" +
            "karaoke( yang)?( (sudah|udah|telah))? (tersimpan|disimpan|di ?simpan|di ?download|diunduh|di ?unduh|offline)",
        Page.DOWNLOADS to "(hasil |daftar |halaman )?(lagu[- ]?lagu |lagu |musik )?(yang )?((sudah|udah|telah) )?(di ?download|di ?unduh|unduhan|download(an)?|offline)",
        Page.LIKED to "(lagu[- ]?lagu |lagu |daftar )?(yang )?(di ?suka(i)?|favorit|kesukaan|liked( songs)?)",
        Page.LOCAL_MUSIC to "((musik|lagu|video|file|berkas)( dan video| & video)?( yang)?( ada)? di (hp|handphone|ponsel|memori|penyimpanan)|musik lokal|lagu lokal|video lokal|file musik|berkas musik)",
        Page.MONTHLY to "(rekap|ringkasan|statistik|monthly)( freease)? (bulanan|bulan ini|per bulan)|monthly( freease)?|rekap bulanan",
        Page.STATS to "(statistik|stats|stat)( saya| dengar(an)?| mendengarkan)?",
        Page.HISTORY to "(riwayat|histori|history)( putar| lagu| dengar(an)?)?|lagu yang (pernah|barusan|tadi) (di ?putar|di ?dengar)",
        Page.EQUALIZER to "(equalizer|ekualiser|ekualizer|eq|equaliser|pengatur suara)",
        Page.SETTINGS to "(pengaturan|setelan|settings?|setting(an)?|konfigurasi)( aplikasi| freease)?",
        Page.ALARMS to "(alarm( musik)?)",
        Page.CAR to "(mode (mobil|berkendara|nyetir|motor)|car mode)",
        Page.RECOGNIZE to "(kenali lagu|pengenal lagu|deteksi lagu|cari lagu (dari|lewat) suara|shazam)",
        Page.IMPORT to "(impor|import)( playlist| spotify| lagu)*",
        Page.VOICE_PACK to "(suara (dev|developer|kodok)( kejepit)?|paket suara|kodok kejepit)",
        Page.QUEUE to "(antrean|antrian|queue|daftar putar( berikutnya)?|lagu (berikutnya|selanjutnya) apa saja)",
        Page.PLAYER to "(pemutar|player|now playing|lagu yang (sedang|lagi) (di ?putar|main))",
        Page.SEARCH to "(pencarian|cari|search|halaman cari)",
        Page.LIBRARY to "(koleksi|library|perpustakaan|pustaka|playlist saya|playlist ku|playlistku)",
        Page.HOME to "(beranda|home|halaman (utama|depan|awal)|menu utama|depan|awal)",
    ).map { (p, re) -> p to Regex("^(?:halaman |menu |tab |bagian |page |layar )?(?:$re)(?:nya|ku| saya| aku| gua| gue)?$") }

    /** "buka beranda", "pergi ke koleksi", "rekap tahunan", "buka playlist santai", "kembali". */
    fun parseOpen(t: String): VoiceCommand? {
        if (Regex("^(kembali|balik|mundur|back)( lagi)?$").matches(t)) return VoiceCommand.Back
        val m = Regex("^$OPEN_VERB\\s+(.+)$").find(t)
        val target = (m?.groupValues?.get(1) ?: t).trim()
        // Rekap tahunan / Wrapped (boleh dengan tahun).
        Regex("^(?:halaman )?(?:rekap|ringkasan) (?:tahunan|setahun|tahun(?: ini)?)(?: (\\d{4}))?$|^(?:freease )?wrapped(?: (\\d{4}))?$").find(target)?.let { w ->
            val year = (w.groupValues[1].ifEmpty { w.groupValues[2] }).toIntOrNull()
            return VoiceCommand.OpenWrapped(year)
        }
        if (m != null) {
            Regex("^daily ?mix(?: (\\w+))?$").find(target)?.let { d ->
                val n = d.groupValues[1].let { it.toIntOrNull() ?: NUMBER_WORDS[it] ?: 1 }
                return VoiceCommand.OpenDailyMix(n.coerceIn(1, 4))
            }
            Regex("^playlist (.+)$").find(target)?.let { return VoiceCommand.OpenPlaylist(clean(it.groupValues[1])) }
            Regex("^(?:halaman |profil )?(?:artis|penyanyi|band|channel) (.+)$").find(target)?.let { return VoiceCommand.OpenArtist(clean(it.groupValues[1])) }
        }
        val page = PAGES.firstOrNull { it.second.matches(target) }?.first ?: return null
        // Tanpa kata "buka/pergi ke", koleksi yang bisa diputar ("lagu yang sudah di download") tetap berarti putar.
        if (m == null && (page == Page.DOWNLOADS || page == Page.LIKED)) return null
        return VoiceCommand.Open(page)
    }

    /** [preferPlay]: dipanggil lewat "Oke Freease" — kalimat tanpa kata kerja ("Tulus") dianggap minta diputar. */
    fun parse(raw: String, preferPlay: Boolean = false): VoiceCommand? {
        var t = raw.lowercase().replace(Regex("[.,!?]"), " ")
        t = FILLER.replace(t, " ").replace(Regex("\\s+"), " ").trim()
        if (t.isEmpty()) return null
        fun has(vararg re: String) = re.any { Regex(it).containsMatchIn(t) }

        // Lirik tetap lewat perintah lirik (bukan halaman).
        if (has("^(tampilkan|buka|lihat|munculkan)? ?lirik(nya)?( lagu( ini)?)?$")) return VoiceCommand.ShowLyrics
        // Pindah halaman — sebelum kontrol pemutar supaya "buka karaoke tersimpan" tidak menyalakan karaoke.
        parseOpen(t)?.let { return it }

        // Kontrol pemutar.
        if (has("^(lagu )?(selanjutnya|berikutnya)$", "^(next|skip)( lagu| song)?$", "^(lewati|lewatin|ganti)( lagu(nya)?( ini)?)?$", "lagu (selanjutnya|berikutnya)$")) return VoiceCommand.Next
        if (has("^(lagu )?sebelumnya$", "^previous( song)?$", "lagu sebelumnya", "^kembali( ke)? lagu sebelumnya$")) return VoiceCommand.Previous
        if (has("^(jeda|pause|stop|berhenti|hentikan|diam|matikan musik(nya)?)( lagu(nya)?| musik(nya)?)?$")) return VoiceCommand.Pause
        if (has("^(lanjutkan|lanjut|resume|play|putar lagi|mainkan lagi|lanjutin)( lagu(nya)?| musik(nya)?)?$")) return VoiceCommand.Resume
        if (has("^(suka|like|sukai|love)( lagu( ini)?| this song)?$", "tambah(kan)? ke (lagu yang )?disukai", "simpan lagu ini")) return VoiceCommand.Like
        if (has("(matikan|nonaktifkan|stop) (mode )?(acak|shuffle)")) return VoiceCommand.Shuffle(false)
        if (has("^(acak|shuffle)( lagu(nya)?)?$", "(nyalakan|aktifkan|hidupkan) (mode )?(acak|shuffle)")) return VoiceCommand.Shuffle(true)
        if (has("^(ulangi|repeat)( lagu( ini)?)?$")) return VoiceCommand.Repeat
        if (has("(matikan|nonaktifkan|stop) (mode )?karaoke")) return VoiceCommand.Karaoke(false)
        if (has("karaoke")) return VoiceCommand.Karaoke(true)
        if (has("terjemah")) return VoiceCommand.TranslateLyrics
        if (has("^(tampilkan|buka|lihat|munculkan)? ?lirik(nya)?( lagu( ini)?)?$")) return VoiceCommand.ShowLyrics
        if (has("(batalkan|matikan) (timer|pengatur waktu) tidur")) return VoiceCommand.CancelSleep
        sleepMinutes(t)?.let { return VoiceCommand.SleepTimer(it) }
        if (has("lagu apa ini", "^kenali( lagu)?", "what song is this", "judul lagu (yang )?(di ?)?(sekitar|luar)")) return VoiceCommand.Recognize
        if (has("lagu apa (yang )?(sedang |lagi )?(di ?putar|main)", "(ini|sekarang) lagu apa", "judul lagu ini", "siapa (penyanyi|yang nyanyi)")) return VoiceCommand.WhatsPlaying
        if (has("^(keraskan|kerasin|naikkan|naikin|besarkan|gedein)( volume(nya)?| suara(nya)?)?$", "volume (naik|up)", "lebih keras")) return VoiceCommand.Volume(true)
        if (has("^(kecilkan|kecilin|pelankan|turunkan|turunin)( volume(nya)?| suara(nya)?)?$", "volume (turun|down)", "lebih pelan")) return VoiceCommand.Volume(false)
        if (has("^(bantuan|help|bisa apa( saja)?|apa (saja )?yang bisa)", "^(kamu )?apa saja$", "^(kamu )?(bisa )?ngapain( saja)?$")) return VoiceCommand.Help

        // Lanjutan obrolan.
        if (has("^(yang|lagu|musik)? ?(lain(nya)?|berbeda|beda)( dong| lagi)?$", "^(ganti|cari(in)?|putar(in)?|kasih) (yang|lagu) lain(nya)?", "^another( one| song)?$", "^lagu lain( lagi)?$")) return VoiceCommand.More
        if (has("^(putar(in)?|setel|mainkan)? ?(lagu )?yang tadi( lagi)?$", "^(lagu )?(yang )?tadi lagi$", "^ulang(i)? (lagu )?yang tadi$")) return VoiceCommand.Again
        // Rangkuman dengar.
        if (has("(dengar(in|kan)?|dengerin|denger|putar|play) apa (aja|saja)", "rangkuman|ringkasan|rekap (hari|minggu)", "berapa lama (aku |saya |gua |gue )?(dengar|dengerin|denger)")) {
            val days = when {
                has("minggu|pekan|7 hari|seminggu") -> 7
                has("bulan") -> 30
                else -> 1
            }
            return VoiceCommand.Summary(days)
        }
        // Mood / aktivitas: "lagu buat belajar", "lagu galau", "yang lebih santai", "galau" (lewat Oke Freease).
        run {
            val body = t.replace(Regex("^(putar(kan|in)?|mainkan|setel|play|dengarkan|kasih|cariin|carikan)\\s+"), "")
            if (body.startsWith("playlist ")) return@run // "putar playlist santai" = playlist milik sendiri
            // "lagu/musik buat …" atau "yang lebih …": suasana boleh di mana saja dalam kalimat.
            val framed = Regex("^((lagu|musik|playlist)([- ]lagu)? (yang )?(cocok )?(buat|untuk|pas|waktu|saat|biar|yang)\\b|(yang|lagu yang|musik yang) (lebih|agak) )").containsMatchIn(body)
            if (framed) MoodKind.find(body)?.let { return VoiceCommand.PlayMood(it) }
            // Selain itu hanya kalau isinya memang cuma kata suasana ("lagu galau", "galau dong") — bukan judul lagu.
            val bare = body.replace(Regex("^(lagu|musik|playlist)([- ]lagu)? "), "").replace(Regex(" (banget|dong|aja|nih|deh)$"), "").trim()
            MoodKind.entries.firstOrNull { Regex("^(${it.words})$").matches(bare) }?.let { return VoiceCommand.PlayMood(it) }
        }

        // Pencarian eksplisit.
        Regex("^(?:cari(?:kan)?|search|temukan)\\s+(.+)$").find(t)?.let { return VoiceCommand.Search(clean(it.groupValues[1])) }

        // Memutar sesuatu.
        val play = Regex("^(?:putar(?:kan|in)?|mainkan|setel|play|dengarkan|nyalakan)\\s+(.+)$").find(t)
        val target = play?.groupValues?.get(1) ?: t
        if (Regex("^(lagu[- ]?lagu |lagu )?(yang )?(di)?(suka(i)?|favorit(ku| saya)?|kesukaan(ku| saya)?)$").containsMatchIn(target) ||
            target == "liked songs"
        ) return VoiceCommand.PlayLiked
        if (Regex("^(lagu[- ]?lagu |lagu )?(yang )?(sudah |udah |telah )?(di ?unduh|di ?download|unduhan|download(an)?|offline)").containsMatchIn(target)) return VoiceCommand.PlayDownloads
        Regex("^daily ?mix(?: (\\w+))?$").find(target)?.let { m ->
            val n = m.groupValues[1].let { it.toIntOrNull() ?: NUMBER_WORDS[it] ?: 1 }
            return VoiceCommand.PlayDailyMix(n.coerceIn(1, 4))
        }
        Regex("^playlist (.+)$").find(target)?.let { return VoiceCommand.PlayPlaylist(clean(it.groupValues[1])) }
        val q = clean(target.replace(Regex("^(lagu[- ]?lagu|lagu(nya)?|musik) (dari |dari penyanyi |oleh )?"), ""))
        if (q.isEmpty()) return VoiceCommand.Resume
        return if (play != null || preferPlay) VoiceCommand.Play(q) else VoiceCommand.Search(q)
    }

    /** Kata "freease" sudah dibuang sebagai pengisi, jadi sisa "di/pakai/lewat" di akhir ikut dibuang. */
    private fun clean(s: String) = s.replace(Regex("\\s+(di|pakai|lewat|dengan)( freease)?$"), "").trim()

    /** "timer tidur 30 menit", "matikan musik dalam satu jam", "tidur 45 menit lagi". */
    fun sleepMinutes(t: String): Int? {
        if (!Regex("(timer|tidur|matikan|berhenti|stop)").containsMatchIn(t)) return null
        val m = Regex("(\\d+|${NUMBER_WORDS.keys.sortedByDescending { it.length }.joinToString("|")}) ?(menit|jam|min)").find(t) ?: return null
        val n = m.groupValues[1].toIntOrNull() ?: NUMBER_WORDS[m.groupValues[1]] ?: return null
        val minutes = if (m.groupValues[2] == "jam") n * 60 else n
        return minutes.takeIf { it in 1..600 }
    }
}
