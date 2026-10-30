#!/bin/sh
# YouTube sering berubah: perbarui yt-dlp tiap container dinyalakan (lewati dengan YTDLP_AUTO_UPDATE=0).
if [ "${YTDLP_AUTO_UPDATE:-1}" = "1" ]; then
  python3 -m pip install --user --no-cache-dir --break-system-packages -q -U yt-dlp 2>/dev/null \
    && export PATH="$HOME/.local/bin:$PATH" || true
fi
exec "$@"
