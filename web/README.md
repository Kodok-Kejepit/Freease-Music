# Freease Web

Versi web Freease: pemutar musik pribadi tanpa iklan yang jalan di **HP, tablet, laptop, dan PC** — bisa di-*install* seperti aplikasi (PWA).

- **Server** (`server/`, Node.js): pencarian & info YouTube/YouTube Music, lirik berwaktu (LRCLIB), dan **proxy audio** (audio diambil server lalu diteruskan ke browser → tanpa iklan, tetap jalan saat layar HP mati).
- **Aplikasi web** (`client/`, React + Vite): tampilan responsif (HP: navigasi bawah + mini player; laptop/PC: sidebar + bar pemutar + panel lirik/antrean).

## Fitur

| | Freease Web | App Android |
|---|---|---|
| Cari lagu/video/artis/playlist/album, link YouTube — hasil terus dimuat saat di-scroll | Ya | Ya |
| Video klip tanpa iklan (Lagu/Video, layar penuh), kualitas 360p–4K & audio Tinggi/Hemat data | Ya | Ya |
| Cari di **YouTube Music** (lagu, artis, album, playlist) atau **YouTube** (semua video, kanal, playlist) | Ya | Ya |
| Layar tonton ala YouTube (video di atas, info, “Berikutnya” dari video terkait); mode bioskop di laptop | Ya | – |
| Layar penuh: HP otomatis miring, kontrol di atas video, ketuk dua kali kiri/kanan = ±10 detik | Ya | Ya |
| Subtitle video + **terjemahan Indonesia** otomatis, ukuran bisa diatur, tampil juga saat layar penuh | Ya | – |
| Info video (suka, subscriber, tanggal), deskripsi & judul bisa diterjemahkan, bab yang bisa diketuk | Ya | – |
| Video terkait, lanjutkan menonton dari posisi terakhir, lewati sponsor otomatis (SponsorBlock) | Ya | sebagian |
| Terjemahan lirik Indonesia di bawah tiap baris (disimpan di browser) | Ya | Ya |
| Halaman profil pembuat (Kodok-Kejepit) + proyek lain: JRG & Freease OSINT Tool | Ya | – |
| Hapus riwayat putar (per item di Beranda/Riwayat), riwayat pencarian, lirik tersimpan, atau semua data | Ya | Ya |
| Putar tanpa iklan, antrean (seret ≡ untuk urutkan), acak, ulangi, putar otomatis/radio | Ya | Ya |
| Lirik berwaktu (ketuk baris untuk lompat), lirik offline, geser waktu lirik per lagu | Ya | Ya (+ terjemahan, romanisasi) |
| Lirik melayang (jendela kecil di atas aplikasi lain) | Ya (Picture-in-Picture, Chrome/Edge) | Ya |
| Lirik di notifikasi & layar kunci | Ya (Media Session) | Ya |
| Lagu disukai, playlist + folder, playlist pintar, artis diikuti | Ya | Ya |
| Riwayat & statistik (jam/hari favorit, lagu sering dilewati) | Ya | Ya (+ Wrapped, Monthly) |
| Unduh untuk offline (tersimpan di browser) | Ya | Ya |
| Musik & video dari perangkat | Ya (pilih/seret berkas) | Ya |
| Equalizer 10 band + bass boost anti-pecah | Ya | Ya |
| Mode Karaoke | Beta: trik audio tanpa AI (belum sempurna) + volume vokal | Ya AI + skor & rekam |
| Freease Smart (perintah suara bahasa Indonesia, Suara Dev) | Ya (Chrome/Edge; bisa juga diketik) | Ya |
| "Oke Freease" tanpa tombol | Ya selama tab terbuka (Chrome/Edge) | Ya |
| Kontrol di layar kunci/notifikasi, tombol media keyboard | Ya (Media Session) | Ya |
| Kecepatan putar, timer tidur | Ya | Ya |
| Cadangan — **format sama dengan app Android** (pindah HP ke web dan sebaliknya) | Ya | Ya |
| Pintasan keyboard: Spasi, ←/→ (5 dtk), Shift+←/→ (lagu), ↑/↓ (volume), `/` (cari), `m` (asisten) | Ya | – |

Belum ada di web: Karaoke AI (terlalu berat untuk browser HP), skor & rekam nyanyian, kenali lagu (Shazam), widget
layar beranda (browser tidak mengizinkan web membuat widget), Android Auto, impor Spotify.

## Menjalankan di komputer sendiri (coba-coba)

Butuh Node.js 20+ dan (disarankan) [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation).

```bash
cd web/client && npm ci && npm run build
cd ../server && npm ci && npm start          # → http://localhost:8080
```

Saat mengembangkan tampilan: `npm run dev` di `server/` dan `npm run dev` di `client/` (buka http://localhost:5173).

## Hosting di VPS (paling mudah: install.sh)

Cukup VPS **1 vCPU / 1 GB RAM** (Ubuntu/Debian) untuk dipakai sendiri atau beberapa teman.

```bash
git clone https://github.com/Kodok-Kejepit/freease-music.git && cd freease-music/web
sudo ./install.sh                         # → http://IP-VPS:8080
sudo ./install.sh musik.domainmu.com      # → https://musik.domainmu.com (arahkan DNS A-record ke IP VPS dulu)
```

Skrip ini otomatis: membuat swap 2 GB (wajib di VPS 1 GB), memasang Docker, membuat `.env` berisi kata sandi
acak, membangun & menjalankan Freease Web (+ penyedia PO Token, + HTTPS bila memakai domain), lalu **langsung
mengetes apakah IP VPS diblokir YouTube** dengan 3 lagu uji. Kata sandi & alamat dicetak di akhir.

Domain disimpan di `.env`, jadi menjalankan ulang `sudo ./install.sh` tanpa argumen tetap memakai domain yang sama.

**Ganti kata sandi:** `sudo ./ganti-password.sh` (ditanya sandi baru), lalu masuk lagi di browser.

**Memperbarui ke versi terbaru:** `sudo ./update.sh` (ambil kode dari GitHub → amankan VPS → bangun ulang → tes).

Tes ulang kapan saja dari VPS: `curl -s localhost:8080/api/diagnose` (tes & status hanya bisa dipanggil dari
server sendiri, tidak dari pengunjung).

Hemat RAM untuk VPS kecil (sudah diatur di `docker-compose.yml`): batas memori tiap layanan, heap Node 192 MB,
maksimal 2 proses yt-dlp bersamaan, dan permintaan lagu yang sama tidak diproses dua kali. Pemakaian ±250–450 MB.

Tanpa Docker: install Node.js 20+, `pip install -U yt-dlp bgutil-ytdlp-pot-provider`, build seperti di atas, lalu
jalankan `npm start` di `server/` (pakai `pm2`/systemd supaya hidup terus).

### Pengaturan server (variabel lingkungan)

| Variabel | Fungsi |
|---|---|
| `PORT` | Port server (bawaan 8080) |
| `FREEASE_PASSWORD` | Kata sandi masuk. **Sangat disarankan** — tanpa ini siapa pun bisa memakai bandwidth server |
| `FREEASE_SECRET` | Teks acak panjang untuk cookie login (supaya tetap masuk setelah server restart) |
| `FREEASE_REGION` / `FREEASE_LANG` | Wilayah & bahasa hasil YouTube (bawaan `ID` / `id`) |
| `POT_PROVIDER_URL` | Alamat penyedia PO Token (bgutil), mis. `http://bgutil:4416` |
| `YT_COOKIES_FILE` | Berkas cookies YouTube (format Netscape) bila server tetap diblokir |
| `VOICE_DIR` | Folder klip Suara Dev (`greet.ogg`, `ack.ogg`, …) |
| `YTDLP_PATH` | Lokasi yt-dlp (bawaan `yt-dlp`) |
| `YTDLP_CONCURRENCY` | Maksimal proses yt-dlp bersamaan (bawaan 2) |
| `DOMAIN` | Domain untuk HTTPS otomatis (profil `https`) |
| `BIND_ADDR` | Alamat port 8080 di host. `127.0.0.1` (diisi otomatis bila memakai domain) = hanya lewat HTTPS |
| `RATE_LIMIT_PER_MIN` | Batas permintaan per IP per menit (bawaan 600) |
| `TRUST_PROXY` | Proxy yang dipercaya untuk IP asli pengunjung (bawaan jaringan lokal/Docker; `false` = tidak ada) |

### Keamanan

Bawaan di server: kata sandi wajib, login dikunci 15 menit setelah 8 kali salah (per IP), batas permintaan per
IP, header keamanan, dan IP pengunjung tidak bisa dipalsukan lewat `X-Forwarded-For`. Caddy menambahkan HTTPS +
HSTS dan menutup koneksi lambat (slowloris).

Untuk VPS-nya jalankan sekali **`sudo ./secure.sh`** (ikut dijalankan oleh `update.sh`): firewall ufw (hanya
SSH/80/443), fail2ban untuk SSH, batas percobaan login SSH, perlindungan SYN flood, pembaruan keamanan otomatis.

Serangan DDoS besar tidak bisa ditahan VPS 1 GB mana pun — untuk itu daftarkan domain ke **Cloudflare (gratis)**:
tambahkan domain di dash.cloudflare.com, ganti nameserver di tempat beli domain ke milik Cloudflare, lalu buat
A-record ke IP VPS dengan awan oranye (Proxied) dan SSL/TLS mode **Full (strict)**. IP VPS jadi tersembunyi.

## Penting: YouTube sering memblokir IP server/VPS

IP pusat data (VPS) sering kena *"Sign in to confirm you're not a bot"*, sehingga server tidak bisa mengambil audio. Freease Web sudah disiapkan untuk itu:

1. **yt-dlp + PO Token** (`bgutil`, sudah ada di `docker-compose.yml`) — cara paling ampuh di VPS. yt-dlp otomatis diperbarui tiap container dinyalakan.
2. **Cookies** — ekspor cookies `youtube.com` dari browser (ekstensi "Get cookies.txt LOCALLY", pakai **akun cadangan**), simpan sebagai `data/cookies.txt`, isi `YT_COOKIES_FILE=/app/data/cookies.txt` di `.env`, lalu `docker compose up -d`.
3. **Tidak ada cadangan player YouTube** — sengaja: player YouTube resmi bisa menayangkan iklan, sedangkan Freease harus 100% tanpa iklan. Lagu yang gagal diambil server dilewati dengan pemberitahuan; kalau server diblokir, perbaiki dengan cookies atau pindah server.
4. **Paling stabil: server di rumah** (PC/laptop/mini PC/STB Armbian) dengan IP rumahan + **Cloudflare Tunnel** (gratis, tanpa buka port, langsung HTTPS):
   ```bash
   docker compose up -d --build
   cloudflared tunnel login
   cloudflared tunnel create freease
   cloudflared tunnel route dns freease musik.domainmu.com
   cloudflared tunnel run --url http://localhost:8080 freease
   ```

## 100% tanpa iklan

Freease tidak pernah memakai player YouTube resmi. Lagu & video diambil sebagai file mentah (audio/video
terpisah) lewat server, sehingga iklan YouTube — yang hanya disisipkan oleh player YouTube — tidak pernah
tayang. Sponsor/promosi yang direkam di dalam video oleh pembuatnya dilewati otomatis oleh SponsorBlock (selalu
aktif). Tes `src/noAds.test.ts` menggagalkan build bila ada kode yang memuat player/iframe YouTube atau skrip
jaringan iklan.

## Video

YouTube memisahkan video dan audio (360p ke atas). Freease memutar audio seperti biasa (EQ, karaoke, timer,
layar kunci tetap jalan) dan video tanpa suara di sampingnya yang terus disamakan waktunya. Codec dipilih
otomatis: VP9 bila browser mendukung (±setengah ukuran H.264 → hemat bandwidth VPS), selain itu H.264
(maks. 1080p). Video berhenti diunduh saat tab disembunyikan. Perkiraan bandwidth per penonton:
720p ±1 Mbps, 1080p ±1,5–3 Mbps, 4K ±13 Mbps.

## Data pengguna

Koleksi (disukai, playlist, riwayat, statistik, unduhan, lirik offline, pengaturan) disimpan **di browser masing-masing** (IndexedDB/localStorage), tidak di server. Server tidak menyimpan apa pun ke disk dan RAM-nya dibatasi: link lagu (maks. 300 lagu, ±1 MB), lirik (300), dan
halaman pencarian lanjutan (60, 15 menit) — sisanya dibuang otomatis. Info lagu, artis, playlist, dan lirik
diberi izin simpan di cache browser masing-masing, jadi permintaan berulang tidak sampai ke VPS. Log error tidak
mencatat kata kunci pencarian, log Docker dibatasi 30 MB, dan image lama dibersihkan setiap install/update. Pindah perangkat/browser → pakai **Pengaturan → Cadangkan / Pulihkan** (berkasnya juga bisa dipulihkan di app Android, dan sebaliknya).

## Tes

```bash
cd server && npm test     # proxy audio (Range & coba ulang), pemisah judul lirik, pembaca hasil YouTube Music
cd client && npm test     # parser perintah suara Freease Smart
```
