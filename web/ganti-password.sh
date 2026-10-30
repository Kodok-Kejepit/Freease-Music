#!/usr/bin/env bash
# Ganti kata sandi Freease Web.   Pemakaian: sudo ./ganti-password.sh            (ditanya)
#                                             sudo ./ganti-password.sh sandiBaru123
# Semua perangkat yang sedang masuk akan keluar dan perlu masuk lagi dengan sandi baru.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Belum ada .env — jalankan ./install.sh dulu"; exit 1; }
NEW="${1:-}"
if [ -z "$NEW" ]; then
  read -rsp "Kata sandi baru: " NEW; echo
  read -rsp "Ulangi kata sandi: " AGAIN; echo
  [ "$NEW" = "$AGAIN" ] || { echo "Tidak sama, coba lagi."; exit 1; }
fi
if [ "${#NEW}" -lt 6 ]; then echo "Minimal 6 karakter."; exit 1; fi
# Karakter berikut punya arti khusus di berkas .env Docker, jadi tidak dipakai.
case "$NEW" in *[[:space:]]*|*\$*|*\"*|*\'*|*\#*|*\\*|*\`*) echo "Jangan pakai spasi atau karakter: \$ \" ' # \\ \`"; exit 1;; esac
grep -v '^FREEASE_PASSWORD=' .env > .env.tmp
printf 'FREEASE_PASSWORD=%s\n' "$NEW" >> .env.tmp
chmod 600 .env.tmp && mv .env.tmp .env
PROFILE=""; grep -qs '^DOMAIN=.\+' .env && PROFILE="--profile https"
docker compose $PROFILE up -d >/dev/null 2>&1
printf '\n\033[1;32mKata sandi diganti.\033[0m Masuk lagi di browser dengan sandi baru.\n'
