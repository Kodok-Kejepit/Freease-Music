<div align="center">

<img src="docs/banner.webp" alt="Freease — musik & video tanpa iklan" width="100%">

<br>

**Dengar musik dan nonton video sepuasnya — tanpa iklan, tanpa langganan, tanpa akun.**<br>
Lirik berjalan, karaoke, subtitle terjemahan Indonesia, dan asisten suara berbahasa Indonesia.<br>
Semua koleksi dan riwayatmu tersimpan di perangkatmu sendiri.

<br>

![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![Web](https://img.shields.io/badge/Web-PWA-5CC8F5?style=for-the-badge&logo=googlechrome&logoColor=white)
![Tanpa iklan](https://img.shields.io/badge/Iklan-0%25-0F2747?style=for-the-badge)
![Lisensi](https://img.shields.io/badge/Lisensi-MIT-8ED2F2?style=for-the-badge)

[**Fitur**](#fitur) &nbsp;·&nbsp; [**Tampilan**](#tampilan) &nbsp;·&nbsp; [**Android**](#android) &nbsp;·&nbsp; [**Web**](#web-self-host) &nbsp;·&nbsp; [**Privasi**](#privasi--100-tanpa-iklan) &nbsp;·&nbsp; [**Pembuat**](#pembuat)

</div>

<br>

## Kenapa Freease?

<table>
<tr>
<td width="33%" valign="top">

### Bersih dari iklan
Lagu dan video diambil sebagai berkas mentah, bukan lewat player YouTube — jadi iklan tidak pernah tayang. Sponsor yang direkam di dalam video pun dilewati otomatis.

</td>
<td width="33%" valign="top">

### Terasa lokal
Antarmuka, asisten suara, lirik terjemahan, sampai subtitle video — semuanya berbahasa Indonesia. Bilang saja *"oke Freease, putar Tulus"*.

</td>
<td width="33%" valign="top">

### Datamu milikmu
Tanpa akun dan tanpa pelacakan. Koleksi, playlist, unduhan, dan riwayat disimpan di HP atau browser-mu, bukan di server.

</td>
</tr>
</table>

## Fitur

| | Android | Web |
|---|:---:|:---:|
| Cari lagu, video, artis, album, playlist — hasil terus dimuat saat di-scroll | Ya | Ya |
| Mode **YouTube Music** (lagu) dan **YouTube** (semua video: film, kartun, vlog) | Ya | Ya |
| Putar di latar belakang, kontrol di notifikasi & layar kunci | Ya | Ya |
| Video tanpa iklan sampai 4K, layar penuh, Picture-in-Picture | Ya | Ya |
| Lirik berjalan, lirik melayang, lirik di layar kunci, **terjemahan Indonesia** | Ya | Ya |
| **Subtitle video** + terjemahan Indonesia otomatis | | Ya |
| Mode Karaoke | Ya (AI) | Beta |
| Skor nyanyi & rekam suara saat karaoke | Ya | |
| **Freease Smart** — asisten suara bahasa Indonesia, *"oke Freease"* tanpa tombol | Ya | Ya |
| Equalizer, bass boost, normalisasi volume, kecepatan & nada | Ya | Ya |
| Unduh untuk didengar offline, putar musik & video dari HP | Ya | Ya |
| Lewati sponsor otomatis (SponsorBlock), lanjutkan menonton dari posisi terakhir | Ya | Ya |
| Playlist, folder, playlist pintar, statistik & rekap tahunan | Ya | Ya |
| Widget layar utama, Android Auto, alarm musik, kenali lagu | Ya | |
| Cadangan koleksi — **formatnya sama**, bisa pindah dari Android ke Web dan sebaliknya | Ya | Ya |

Daftar lengkap ada di [`android/README.md`](android/README.md) dan [`web/README.md`](web/README.md).

## Tampilan

<div align="center">

<img src="docs/screenshots/web-beranda.webp" alt="Freease Web — Beranda" width="49%">
<img src="docs/screenshots/web-youtube.webp" alt="Freease Web — pencarian YouTube" width="49%">

<br><br>

<img src="docs/screenshots/hp-beranda.webp" alt="Beranda di HP" width="24%">
<img src="docs/screenshots/hp-tonton.webp" alt="Layar tonton ala YouTube" width="24%">
<img src="docs/screenshots/hp-lirik.webp" alt="Lirik dengan terjemahan Indonesia" width="24%">
<img src="docs/screenshots/hp-profil.webp" alt="Profil pembuat" width="24%">

</div>

## Android

Aplikasi native: **Kotlin · Jetpack Compose · Media3 (ExoPlayer) · ONNX Runtime**. Butuh JDK 17+ dan Android SDK 35.

```bash
git clone https://github.com/Kodok-Kejepit/freease-music.git
cd freease-music/android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```

Untuk APK rilis, buat `android/keystore.properties` (tidak ikut repo):

```properties
storeFile=../freease-release.jks
storePassword=…
keyAlias=freease
keyPassword=…
```

lalu jalankan `./gradlew assembleRelease`.

> Klip **Suara Dev** (rekaman suara asli pembuat untuk jawaban asisten) tidak disertakan di repo. Tanpa klip itu,
> asisten tetap menjawab memakai suara bawaan HP. Taruh klip `.ogg` di `android/app/src/main/assets/voice_dev/`
> untuk memakainya.

## Web (self-host)

Freease Web berjalan di VPS sendiri — cukup **1 vCPU / 1 GB RAM**, Ubuntu atau Debian. Satu perintah memasang
semuanya: swap, Docker, kata sandi acak, HTTPS otomatis, dan pengamanan server.

```bash
git clone --depth 1 https://github.com/Kodok-Kejepit/freease-music.git
cd freease-music/web
sudo ./install.sh musik.domainmu.com     # tanpa domain: sudo ./install.sh → http://IP-VPS:8080
```

| Perintah | Fungsi |
|---|---|
| `sudo ./update.sh` | Ambil versi terbaru, amankan VPS, bangun ulang, lalu tes |
| `sudo ./ganti-password.sh` | Ganti kata sandi masuk |
| `sudo ./secure.sh` | Firewall, fail2ban, perlindungan SYN flood, pembaruan keamanan otomatis |

Panduan lengkap — variabel lingkungan, cookies, Cloudflare, dan kebutuhan bandwidth — ada di [`web/README.md`](web/README.md).

## Privasi & 100% tanpa iklan

- **Tanpa player YouTube.** Iklan YouTube hanya disisipkan oleh player resminya; Freease tidak pernah memakainya.
  Sebuah tes otomatis menggagalkan build bila ada kode yang memuat player/iframe YouTube atau skrip jaringan iklan.
- **Sponsor di dalam video** dilewati lewat data komunitas SponsorBlock. Hanya 4 karakter awal hash id video yang
  dikirim, jadi layanan itu tidak tahu video apa yang ditonton.
- **Tanpa akun & pelacakan.** Riwayat, koleksi, unduhan, lirik, dan pengaturan disimpan di perangkat. Server Web
  hanya meneruskan lagu & lirik, tidak menulis apa pun ke disk, dan tidak mencatat kata kunci pencarian.

## Struktur

```
freease-music/
├── android/     Aplikasi Android (Kotlin, Jetpack Compose, Media3)
├── web/
│   ├── client/  Aplikasi web (React, TypeScript, Vite, PWA)
│   ├── server/  Server API & stream (Node.js, Express, yt-dlp)
│   └── *.sh     Pemasangan, pembaruan & pengamanan VPS
└── docs/        Banner, logo & tangkapan layar
```

## Kontribusi

Laporan bug, ide fitur, dan pull request sangat diterima — buka lewat
[Issues](https://github.com/Kodok-Kejepit/freease-music/issues). Sebelum mengirim perubahan:

```bash
cd web/client && npm test        # tes klien (termasuk penjaga tanpa-iklan & tanpa-emoji)
cd web/server && npm test        # tes server
cd android && ./gradlew testDebugUnitTest
```

## Pembuat

<table>
<tr>
<td width="120" align="center" valign="top">
<img src="web/client/public/kodok-kejepit.webp" width="100" alt="Kodok-Kejepit">
</td>
<td valign="top">

**[Kodok-Kejepit](https://github.com/Kodok-Kejepit)** — suka membongkar cara kerja sesuatu, lalu membangun versinya sendiri.

Proyek lainnya:
- **[JawaRustGo++](https://jawarustgoplusplus.web.id)** — bahasa pemrograman dengan pesan galat berbahasa Indonesia, ditulis dengan Rust. ([kode sumber](https://github.com/Kodok-Kejepit/jrg))
- **[Freease OSINT Tool](https://github.com/Kodok-Kejepit/freease)** — tool recon & audit attack surface berbasis terminal.

Suka proyek ini? Beri bintang di GitHub dan bagikan ke teman-temanmu.

</td>
</tr>
</table>

## Catatan

Freease adalah proyek pribadi dan tidak berafiliasi dengan YouTube maupun Google. Semua lagu, video, dan lirik
tetap milik pemiliknya masing-masing. Gunakan untuk keperluan pribadi dan dukung artis favoritmu.

## Lisensi

[MIT](LICENSE) © 2026 Kodok-Kejepit

<div align="center">
<br>
<img src="docs/wave.svg" alt="" width="100%">
</div>
