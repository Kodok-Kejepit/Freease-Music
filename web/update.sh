#!/usr/bin/env bash
# Perbarui Freease Web ke versi terbaru di GitHub, amankan VPS, lalu bangun ulang & tes.
#   sudo ./update.sh            (domain diambil dari .env)
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(id -u)" != "0" ]; then echo "Jalankan dengan sudo: sudo ./update.sh"; exit 1; fi
printf '\n\033[1;35m==> Mengambil versi terbaru\033[0m\n'
git -C .. pull -q --ff-only
bash ./secure.sh
bash ./install.sh
