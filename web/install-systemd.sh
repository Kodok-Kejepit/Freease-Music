#!/usr/bin/env bash
# Pasang/perbarui Freease (Musik + Stream) TANPA Docker, untuk VPS yang sudah punya reverse proxy sendiri (Caddy).
# Docker sengaja tidak dipakai di sini: ia menulis aturan iptables sendiri dan melewati ufw.
#   Pemakaian (root, dari folder repo yang sudah berisi client/dist hasil build):  ./install-systemd.sh
# Hasil: layanan systemd `freease` (127.0.0.1:8080) dan `freease-pot` (PO Token YouTube, 127.0.0.1:4416).
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Jalankan sebagai root"; exit 1; }
[ -f client/dist/index.html ] || { echo "client/dist belum ada: jalankan 'npm ci && npm run build' di folder client dulu"; exit 1; }

ROOT=/opt/freease
POT_VERSION=2.0.2
id freease >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin freease
mkdir -p "$ROOT"/{voice,data}

say "Menyalin aplikasi"
rm -rf "$ROOT/app.new" && mkdir -p "$ROOT/app.new/server" "$ROOT/app.new/client"
cp -r server/package.json server/package-lock.json server/src "$ROOT/app.new/server/"
cp -r client/dist "$ROOT/app.new/client/"
(cd "$ROOT/app.new/server" && npm ci --omit=dev --no-audit --no-fund --silent)
rm -rf "$ROOT/app.old"; if [ -d "$ROOT/app" ]; then mv "$ROOT/app" "$ROOT/app.old"; fi; mv "$ROOT/app.new" "$ROOT/app"

say "yt-dlp + plugin PO Token"
[ -x "$ROOT/venv/bin/python" ] || python3 -m venv "$ROOT/venv"
"$ROOT/venv/bin/pip" install -q -U pip yt-dlp bgutil-ytdlp-pot-provider

if [ ! -f "$ROOT/pot/server/build/main.js" ] || ! grep -q "\"version\": \"$POT_VERSION\"" "$ROOT/pot/server/package.json" 2>/dev/null; then
  say "Penyedia PO Token $POT_VERSION"
  rm -rf "$ROOT/pot" && git clone -q --depth 1 --branch "$POT_VERSION" https://github.com/Brainicism/bgutil-ytdlp-pot-provider "$ROOT/pot"
  (cd "$ROOT/pot/server" && npm ci --no-audit --no-fund --silent && npx tsc && npm prune --omit=dev --silent)
fi

if [ ! -f "$ROOT/.env" ]; then
  say "Membuat $ROOT/.env (kata sandi & kunci acak)"
  PASS="$(tr -dc 'a-z0-9' </dev/urandom | head -c 12 || true)"
  SECRET="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 || true)"
  cat > "$ROOT/.env" <<EOF
FREEASE_PASSWORD=$PASS
FREEASE_SECRET=$SECRET
FREEASE_REGION=ID
FREEASE_LANG=id
HOST=127.0.0.1
PORT=8080
CLIENT_DIR=$ROOT/app/client/dist
VOICE_DIR=$ROOT/voice
YTDLP_PATH=$ROOT/venv/bin/yt-dlp
YTDLP_CONCURRENCY=2
POT_PROVIDER_URL=http://127.0.0.1:4416
NODE_OPTIONS=--max-old-space-size=256
# YT_COOKIES_FILE=$ROOT/data/cookies.txt
EOF
fi
chmod 600 "$ROOT/.env"
chown -R freease:freease "$ROOT"

say "Layanan systemd"
cat > /etc/systemd/system/freease-pot.service <<EOF
[Unit]
Description=Freease: penyedia PO Token YouTube (bgutil)
After=network-online.target
[Service]
User=freease
WorkingDirectory=$ROOT/pot/server
ExecStart=/usr/bin/node build/main.js --port 4416
Environment=NODE_OPTIONS=--max-old-space-size=160
Restart=always
RestartSec=5
MemoryMax=350M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/freease.service <<EOF
[Unit]
Description=Freease (Musik + Stream)
After=network-online.target freease-pot.service
Wants=freease-pot.service
[Service]
User=freease
WorkingDirectory=$ROOT/app/server
EnvironmentFile=$ROOT/.env
Environment=PATH=$ROOT/venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=PIP_NO_CACHE_DIR=1
# YouTube sering berubah: perbarui yt-dlp tiap layanan dinyalakan (gagal tidak menghalangi start).
ExecStartPre=-$ROOT/venv/bin/pip install -q -U yt-dlp
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
MemoryMax=700M
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$ROOT/venv
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now freease-pot.service >/dev/null 2>&1
systemctl enable freease.service >/dev/null 2>&1
systemctl restart freease.service

say "Menunggu server siap"
for _ in $(seq 1 60); do curl -fs http://127.0.0.1:8080/api/config >/dev/null 2>&1 && break; sleep 2; done
curl -fs http://127.0.0.1:8080/api/config && echo
rm -rf "$ROOT/app.old"
echo "Selesai. Arahkan reverse proxy ke 127.0.0.1:8080. Kata sandi ada di $ROOT/.env (FREEASE_PASSWORD)."
