# Freease untuk Android

Aplikasi native, ditulis pakai Kotlin, Jetpack Compose, dan Media3 (ExoPlayer). Lagu dan video diambil dari
YouTube dan YouTube Music lewat NewPipeExtractor, lalu diputar langsung tanpa iklan.

Di bawah ini daftar fitur yang sudah ada sejauh ini.

## Pemutar

- Audio kualitas tertinggi (Opus/AAC sekitar 160 sampai 256 kbps), ada pilihan hemat data, dan bisa otomatis hemat
  saat pakai data seluler
- Jalan di latar belakang dengan kontrol di notifikasi, layar kunci, headset, dan Bluetooth
- Fade halus waktu play/pause, crossfade 0 sampai 12 detik, gapless, dan crossfade pintar (lagu satu album
  disambung tanpa jeda)
- Equalizer dengan preset dan band manual, bass boost, virtualizer 3D, dan penguat volume. EQ sistem seperti Dolby
  juga bisa dipakai
- Profil EQ per perangkat: speaker HP, headset kabel, DAC USB, dan tiap perangkat Bluetooth punya setelan sendiri
  yang berganti otomatis
- Normalisasi volume (LUFS, ITU-R BS.1770) supaya lagu pelan dan keras terdengar sama
- Lewati bagian hening, atur kecepatan dan nada (0,5x sampai 2x), bisa diingat per lagu
- Timer tidur dengan fade-out
- Mode lagu dan video di pemutar yang sama, video sampai 1080p, layar penuh, Picture-in-Picture, dan siaran langsung
- Antrean bisa diurutkan dengan diseret dan dihapus dengan digeser. Saat antrean habis, lagu serupa diputar otomatis
- Antrean terakhir disimpan dan dilanjutkan saat aplikasi dibuka lagi
- Smart Shuffle: tekan tombol acak dua kali untuk menyelipkan lagu rekomendasi yang cocok dengan playlist
- Bagian non-musik di video klip (intro ngobrol dan semacamnya) dilewati pakai data komunitas SponsorBlock
- Info audio: codec, bitrate, sample rate, dan loudness lagu yang sedang diputar

## Freease Smart (asisten suara)

- Ngerti perintah bahasa Indonesia, misalnya "putar Tulus", "lagu berikutnya", "lagu apa ini", "nyalakan karaoke",
  "timer tidur 30 menit", atau "buka koleksi"
- "Oke Freease" tanpa pencet tombol selama aplikasi terbuka (pengenal panggilan Vosk, sekitar 40 MB, diunduh sekali)
- Tetap bisa dipakai tanpa internet berkat pengenal suara Whisper yang jalan di HP lewat ONNX Runtime
- Nyambung kalau diajak ngobrol ("yang lain dong", "yang tadi lagi"), bisa putar sesuai suasana ("lagu buat belajar",
  "lagu buat nyetir"), dan bisa merangkum apa saja yang kamu dengar hari ini atau minggu ini
- Semua halaman bisa dibuka lewat suara
- Jawabannya pakai rekaman suara asli pembuat (Suara Dev). Klip bawaannya ada di `app/src/main/assets/voice_dev/`
  dan tidak ikut repo. Kalau klipnya tidak ada, asisten memakai suara bawaan HP
- Bisa dipanggil dari tombol mic, tile Pengaturan Cepat, pintasan ikon aplikasi, widget, dan tekan lama tombol
  earphone. "Ok Google, putar ... di Freease" juga jalan

## Lirik

- Lirik berjalan dari YouTube Music dan LyricFind, dengan LRCLIB sebagai cadangan. Ketuk baris untuk lompat
- Untuk video klip, waktu lirik dicocokkan otomatis dengan suara videonya, jadi tetap pas walaupun ada intro
  atau adegan tambahan
- Terjemahan bahasa Indonesia di bawah tiap baris, lirik karaoke per kata, dan cara baca latin untuk lirik Korea
  dan Jepang
- Kartu lirik untuk dibagikan ke Instagram atau WhatsApp
- Lirik melayang di atas aplikasi lain dan lirik di layar kunci
- Lirik bisa disimpan untuk dibaca offline

## Karaoke

- Vokal dipisahkan model AI (UVR MDX-Net lewat ONNX Runtime) langsung di HP, musiknya tetap utuh
- Ada mode Terbaik (semua vokal hilang) dan Cepat (backing vokal tetap). Model diunduh sekali, atau bisa diimpor
  manual dari berkas .onnx
- Lagu yang sudah diproses disimpan dan bisa diputar lagi tanpa menunggu, offline juga bisa
- Volume vokal asli bisa diatur dari 0 sampai 100 persen
- Skor nyanyi dari deteksi nada lewat mikrofon, dan nyanyianmu bisa direkam lalu digabung dengan musiknya

## Jelajah dan koleksi

- Beranda dengan Daily Mix, lagu dari artis yang kamu ikuti, trending, tangga lagu, dan kategori suasana
- Pencarian dengan saran otomatis, filter lagu, video, album, playlist, dan artis, bisa di-scroll terus
- Tempel atau bagikan link YouTube, atau impor playlist Spotify (maksimal 100 lagu per link)
- Kenali lagu yang sedang diputar di sekitar lewat mikrofon
- Lagu disukai, playlist sendiri, folder playlist, dan playlist pintar (sering diputar, lama tak didengar, dan lain-lain)
- Unduh untuk offline, bisa diatur khusus Wi-Fi
- Putar musik dan video yang ada di HP. Freease juga bisa jadi pemutar bawaan saat membuka berkas dari file manager
  atau WhatsApp
- Riwayat, statistik jam dan hari favorit, Rekap Kamu, dan Freease Wrapped tahunan yang bisa dibagikan
- Cadangan koleksi, termasuk cadangan otomatis mingguan. Formatnya sama dengan Freease Web

## Lain-lain

- Tema gelap dengan 6 warna aksen dan mode AMOLED. Warna pemutar mengikuti sampul lagu
- Canvas: potongan video klip yang berulang di belakang pemutar
- Widget pemutar, lirik, Lanjutkan, dan Freease Smart
- Android Auto dan mode mobil dengan tombol besar
- Alarm musik dengan volume yang naik pelan-pelan
- Hemat baterai otomatis saat baterai di bawah 15 persen

## Build

Butuh JDK 17 dan Android SDK 35.

```bash
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # perlu keystore.properties
```

Untuk build rilis, bikin `keystore.properties` di folder ini berisi `storeFile`, `storePassword`, `keyAlias`, dan
`keyPassword`. Berkas itu tidak ikut repo.

## Struktur

```
app/src/main/java/com/freease/music/
├── data/        model, database Room, YouTube, lirik, pengaturan, unduhan, impor Spotify,
│                musik lokal, alarm, Daily Mix, kenali lagu, Wrapped
├── playback/    PlaybackService, resolver stream, cache, equalizer, normalisasi volume,
│                crossfade, timer tidur, lirik melayang, Canvas
├── assistant/   Freease Smart: pemahaman perintah, pengenal suara, dan suara jawaban
├── karaoke/     pemisahan vokal (STFT dan MDX-Net) dan pemutarannya
└── ui/          tema, komponen, semua layar, dan pemutar
```

## Catatan

- YouTube sering mengubah sistemnya. Kalau suatu saat lagu gagal diputar atau dicari, naikkan versi `newpipe`
  di `gradle/libs.versions.toml` ke rilis NewPipeExtractor terbaru lalu build ulang.
- Tes: `./gradlew testDebugUnitTest`. Tes screenshot Robolectric bisa merender layar asli ke PNG dengan
  `-PshotsDir=build/shots`.
- Fitur Kenali Lagu memakai layanan pengenal lagu milik Shazam (bukan API resmi), jadi bisa berhenti bekerja
  kalau layanannya berubah.
