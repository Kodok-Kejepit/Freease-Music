#!/usr/bin/env bash
# Pasang Freease Web di VPS (Ubuntu/Debian) dalam sekali jalan, lalu langsung tes apakah IP VPS ini
# diblokir YouTube.   Pemakaian:  sudo ./install.sh                 → http://IP-VPS:8080
#                                 sudo ./install.sh musik.domainmu.com → https://musik.domainmu.com
#   Domain diingat di .env: menjalankan ulang tanpa argumen tetap memakai domain yang sama.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="${1:-$(grep -s '^DOMAIN=' .env | cut -d= -f2- || true)}"
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" != "0" ]; then echo "Jalankan dengan sudo: sudo ./install.sh $DOMAIN"; exit 1; fi

# 1. Swap — VPS 1 GB butuh total swap ±2 GB supaya build & yt-dlp tidak kehabisan RAM.
#    Banyak provider sudah memberi swap kecil (mis. 256 MB); kekurangannya ditambah dengan berkas baru.
SWAP_MB="$(free -m | awk '/^Swap:/ {print $2}')"
if [ "${SWAP_MB:-0}" -lt 1800 ]; then
  ADD=$((2048 - ${SWAP_MB:-0}))
  say "Menambah swap ${ADD} MB (sekarang ${SWAP_MB:-0} MB)"
  if [ ! -f /swapfile-freease ]; then
    fallocate -l "${ADD}M" /swapfile-freease || dd if=/dev/zero of=/swapfile-freease bs=1M count="$ADD"
    chmod 600 /swapfile-freease && mkswap /swapfile-freease >/dev/null
  fi
  swapon /swapfile-freease 2>/dev/null || true
  grep -q '^/swapfile-freease' /etc/fstab || echo '/swapfile-freease none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=20 >/dev/null
fi

# 2. Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Memasang Docker"
  curl -fsSL https://get.docker.com | sh
fi

# 3. Pengaturan (.env): kata sandi & kunci acak dibuat otomatis.
mkdir -p voice data
if [ ! -f .env ]; then
  say "Membuat .env"
  PASS="$(tr -dc 'a-z0-9' </dev/urandom | head -c 10 || true)"
  SECRET="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 || true)"
  sed -e "s/^FREEASE_PASSWORD=.*/FREEASE_PASSWORD=$PASS/" -e "s/^FREEASE_SECRET=.*/FREEASE_SECRET=$SECRET/" .env.example > .env
fi
# setenv KUNCI NILAI: ganti baris di .env, atau tambahkan bila belum ada.
setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
if [ -n "$DOMAIN" ]; then
  setenv DOMAIN "$DOMAIN"
  # Pasangan www/tanpa-www ikut dilayani (lalu dialihkan ke DOMAIN) bila DNS-nya mengarah ke server yang sama.
  case "$DOMAIN" in www.*) ALT="${DOMAIN#www.}" ;; *) ALT="www.$DOMAIN" ;; esac
  ip_of() { getent ahostsv4 "$1" 2>/dev/null | awk 'NR==1 {print $1}'; }
  if [ -n "$(ip_of "$ALT")" ] && [ "$(ip_of "$ALT")" = "$(ip_of "$DOMAIN")" ]; then SITES="$DOMAIN $ALT"; else SITES="$DOMAIN"; fi
  setenv SITES "$SITES"
  setenv BIND_ADDR 127.0.0.1   # akses hanya lewat https://domain, port 8080 tertutup dari luar
else
  setenv BIND_ADDR 0.0.0.0
fi
if [ -z "$(ls -A voice 2>/dev/null)" ] && [ -d ../android/app/src/main/assets/voice_dev ]; then
  cp ../android/app/src/main/assets/voice_dev/* voice/
fi

# 4. Build & jalankan (build pertama ±5–10 menit di VPS 1 vCPU).
say "Membangun & menjalankan Freease Web"
if [ -n "$DOMAIN" ]; then docker compose --profile https up -d --build; else docker compose up -d --build; fi
# Bersihkan image & cache build lama supaya SSD tidak penuh setelah berkali-kali update (±500 MB per versi).
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true

# 5. Tunggu siap, lalu tes IP.
say "Menunggu server siap"
for _ in $(seq 1 60); do curl -fs http://localhost:8080/api/config >/dev/null 2>&1 && break; sleep 2; done
PASS="$(grep '^FREEASE_PASSWORD=' .env | cut -d= -f2-)"
COOKIE="$(mktemp)"
curl -fs -c "$COOKIE" -H 'content-type: application/json' -d "{\"password\":\"$PASS\"}" http://localhost:8080/api/login >/dev/null || true
say "Tes: apakah IP VPS ini bisa mengambil audio YouTube? (±30 detik)"
RESULT="$(curl -s -b "$COOKIE" --max-time 120 http://localhost:8080/api/diagnose || echo '{"ok":false,"message":"server tidak menjawab"}')"
rm -f "$COOKIE"
echo "$RESULT"
if echo "$RESULT" | grep -q '"ok":true'; then
  printf '\n\033[1;32mBERHASIL — IP VPS ini lolos. Freease Web siap dipakai tanpa iklan.\033[0m\n'
else
  printf '\n\033[1;33mIP VPS ini masih diblokir YouTube — lagu belum bisa diputar (Freease tidak memakai player YouTube\nkarena bisa ada iklan). Coba: cookies (lihat README), atau pindah ke server rumah + Cloudflare Tunnel.\033[0m\n'
fi
IP="$(curl -fs https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
if [ -n "$DOMAIN" ]; then
  echo "Buka:        https://$DOMAIN"
  [ "$SITES" != "$DOMAIN" ] && echo "             (https://${SITES#* } otomatis dialihkan ke sini)"
  [ "$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')" = "$IP" ] || echo "             DNS $DOMAIN belum mengarah ke $IP — tambahkan A-record dulu"
else
  echo "Buka:        http://$IP:8080"
fi
echo "Kata sandi:  $PASS"
echo "Ganti sandi: sudo ./ganti-password.sh"
