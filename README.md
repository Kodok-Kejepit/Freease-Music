<div align="center">

<img src="docs/banner.webp" alt="Freease" width="100%">

<br>

[![Versi](https://img.shields.io/github/v/release/Kodok-Kejepit/Freease-Music?style=for-the-badge&label=Versi&color=5CC8F5)](https://github.com/Kodok-Kejepit/Freease-Music/releases/latest)
![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![Lisensi](https://img.shields.io/badge/Lisensi-MIT-8ED2F2?style=for-the-badge)

[![Unduh APK](https://img.shields.io/badge/Unduh_APK-Android-0F2747?style=for-the-badge&logo=android&logoColor=3DDC84&labelColor=16345E)](https://github.com/Kodok-Kejepit/Freease-Music/releases/latest)
&nbsp;
[![Freease Web](https://img.shields.io/badge/Versi_web-freease.cloud-0F2747?style=for-the-badge&logo=googlechrome&logoColor=8ED2F2&labelColor=16345E)](https://freease.cloud)

</div>

<br>

Freease itu aplikasi musik yang aku bikin buat dipakai sendiri, karena capek sama iklan yang muncul tiap ganti lagu.
Lagunya diambil dari YouTube dan YouTube Music, tapi diputar langsung dari berkas aslinya, jadi iklannya nggak
pernah ikut. Nggak perlu akun, nggak ada langganan, dan semua koleksi kamu tersimpan di HP kamu sendiri.

Lama-lama fiturnya nambah terus: lirik yang jalan sesuai lagu, mode karaoke, asisten suara yang ngerti bahasa
Indonesia, sampai bisa nonton video YouTube apa aja tanpa iklan. Sekarang ada juga **Freease Stream**, di aplikasi
dan di web, buat nonton anime dan donghua subtitle Indonesia, sama baca manga, manhwa, dan manhua.

## Yang bisa dilakukan

**Dengerin musik**
- Cari lagu, artis, album, atau playlist. Hasilnya bisa di-scroll terus
- Tetap jalan di latar belakang, bisa dikontrol dari notifikasi dan layar kunci
- Equalizer, bass boost, normalisasi volume, atur kecepatan dan nada
- Unduh lagu buat didengar offline, atau putar musik yang sudah ada di HP
- Bagian yang bukan musik di video klip, misalnya intro ngobrol, dilewati otomatis

**Lirik dan karaoke**
- Lirik berjalan, bisa melayang di atas aplikasi lain atau tampil di layar kunci
- Terjemahan bahasa Indonesia di bawah tiap baris lirik
- Mode karaoke pakai AI yang jalan langsung di HP, plus skor nyanyi dan rekam suara

**Video**
- Ganti dari mode lagu ke video kapan aja, kualitas sampai 1080p, tanpa iklan
- Layar penuh dan Picture-in-Picture

**Freease Stream**
- Anime subtitle Indonesia dari Animekompi dan Otakudesu, donghua dari Anichin, banyak yang sampai 1080p
- Baca manga, manhwa, dan manhua dari tujuh sumber, plus terjemahan bahasa Indonesia langsung di atas balon kata
- Jadwal rilis, lanjut dari menit terakhir, dan "Oke Freease, buka donghua" juga bisa

**Lainnya**
- Freease Smart: bilang "oke Freease, putar Tulus" dan langsung jalan
- Playlist, folder, playlist pintar, statistik, sampai rekap tahunan
- Widget layar utama, Android Auto, alarm musik, dan kenali lagu yang lagi diputar di sekitar
- Cadangan koleksi yang bisa dipindah ke versi web, dan sebaliknya

Daftar lengkapnya ada di [android/README.md](android/README.md).

## Tampilan

<div align="center">

<img src="docs/screenshots/apk-lirik.webp" alt="Lirik berjalan" width="24%">
<img src="docs/screenshots/apk-asisten.webp" alt="Freease Smart" width="24%">
<img src="docs/screenshots/apk-wrapped.webp" alt="Freease Wrapped" width="24%">
<img src="docs/screenshots/apk-rekap.webp" alt="Rekap tahunan" width="24%">

</div>

## Unduh

Ambil berkas `Freease-x.x.x.apk` terbaru di halaman [Releases](https://github.com/Kodok-Kejepit/Freease-Music/releases/latest),
buka di HP, lalu pasang. Kalau HP minta izin pasang dari sumber tidak dikenal, izinkan saja.

Minimal Android 8.0. Versi baru bisa langsung dipasang di atas versi lama, koleksi kamu tetap aman.

## Versi web

Kalau lagi di laptop atau pakai iPhone, Freease juga bisa dibuka lewat browser di **[freease.cloud](https://freease.cloud)**.
Begitu dibuka, kamu tinggal pilih mau ke Freease Musik atau Freease Stream.

<img src="docs/screenshots/web-pilihan.webp" alt="Pilih Freease Musik atau Freease Stream" width="100%">

**Freease Musik** isinya sama kayak aplikasinya, plus bisa pilih mau cari di YouTube Music atau YouTube biasa,
dan nonton video apa aja dengan subtitle terjemahan Indonesia.

<img src="docs/screenshots/web-beranda.webp" alt="Freease Musik di browser" width="100%">

**Freease Stream** itu tempat nonton dan baca:
- Anime subtitle Indonesia dari Animekompi dan Otakudesu, episode baru biasanya udah ada di hari yang sama
- Donghua dari Anichin, banyak yang sampai 1080p
- Manga, manhwa, dan manhua dari tujuh sumber, ada mode webtoon dan mode per halaman
- Komik bahasa lain bisa langsung diterjemahin ke bahasa Indonesia di atas balon katanya
- Jadwal rilis, lanjut dari menit terakhir, episode berikutnya otomatis, dan pindah sumber kalau servernya kosong

<img src="docs/screenshots/web-donghua.webp" alt="Donghua di Freease Stream" width="100%">

Tampilannya menyesuaikan layar, dari HP sampai monitor lebar, dan bisa dipasang ke layar utama biar kebuka kayak
aplikasi (Chrome: menu, lalu Tambahkan ke layar utama). Kode dan cara pasangnya ada di [web/README.md](web/README.md).

Untuk sekarang versi web masih pakai kata sandi. Kalau mau coba, hubungi aku aja.

## Build sendiri

Butuh JDK 17 dan Android SDK 35.

```bash
git clone https://github.com/Kodok-Kejepit/Freease-Music.git
cd Freease-Music/android
./gradlew assembleDebug
```

APK-nya ada di `app/build/outputs/apk/debug/`. APK rilis di halaman Releases dibuat otomatis lewat GitHub Actions
([build-apk.yml](.github/workflows/build-apk.yml)). Kalau mau build rilis sendiri, bikin `android/keystore.properties`
berisi `storeFile`, `storePassword`, `keyAlias`, dan `keyPassword`, lalu jalankan `./gradlew assembleRelease`.

Versi web butuh Node.js 20+ dan yt-dlp:

```bash
cd Freease-Music/web/client && npm ci && npm run build
cd ../server && npm ci && npm start    # buka http://localhost:8080
```

Mau dipasang di VPS sendiri? Ada skripnya, lengkap di [web/README.md](web/README.md).

## Soal privasi

Freease nggak punya akun dan nggak melacak apa pun. Riwayat, playlist, unduhan, dan pengaturan semuanya disimpan
di perangkat kamu. Untuk melewati sponsor, Freease cuma mengirim 4 karakter awal dari kode acak video ke
SponsorBlock, jadi mereka nggak tahu video apa yang kamu tonton.

## Bikin bareng

Nemu bug atau punya ide fitur? Tulis aja di [Issues](https://github.com/Kodok-Kejepit/Freease-Music/issues).
Pull request juga boleh banget. Sebelum kirim, jalankan dulu `./gradlew testDebugUnitTest` di folder `android`,
atau `npm test` di `web/server` dan `web/client` kalau yang diubah versi web.

## Tentang aku

<table>
<tr>
<td width="110" valign="top"><img src="docs/kodok-kejepit.webp" width="96" alt="Kodok-Kejepit"></td>
<td valign="top">

Aku **[Kodok-Kejepit](https://github.com/Kodok-Kejepit)**, suka bongkar cara kerja sesuatu terus bikin versi sendiri.
Proyek lain yang juga lagi aku kerjain:

- [JawaRustGo++](https://jrg-lang.org), bahasa pemrograman dengan pesan error berbahasa Indonesia, ditulis pakai Rust ([kode](https://github.com/Kodok-Kejepit/jrg))
- [Freease OSINT Tool](https://github.com/Kodok-Kejepit/freease), tool recon dan audit keamanan berbasis terminal

Web Freease: [freease.cloud](https://freease.cloud).

Kalau Freease kepake buat kamu, kasih bintang di repo ini ya. Itu cukup bikin semangat.

</td>
</tr>
</table>

## Catatan

Freease proyek pribadi dan nggak ada hubungannya dengan YouTube, Google, atau situs anime dan komik yang jadi
sumbernya. Lagu, video, anime, komik, dan lirik tetap milik pemiliknya masing-masing, jadi tetap dukung artis dan
kreator favoritmu.

Dirilis dengan lisensi [MIT](LICENSE).

<div align="center">
<br>
<img src="docs/wave.svg" alt="" width="100%">
</div>

## Lisensi

[MIT](LICENSE) © 2026 Kodok-Kejepit.
