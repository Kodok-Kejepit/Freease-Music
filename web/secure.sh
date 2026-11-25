#!/usr/bin/env bash
# Pengamanan dasar VPS untuk Freease Web (Ubuntu/Debian). Aman dijalankan berulang kali.
#   - Firewall ufw: hanya SSH, 80, 443 (dan 8080 bila belum memakai domain)
#   - fail2ban: blokir IP yang menebak-nebak kata sandi SSH
#   - Pembaruan keamanan otomatis, perlindungan SYN flood, batas percobaan login SSH
# Serangan DDoS besar tetap butuh Cloudflare (lihat README).
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
if [ "$(id -u)" != "0" ]; then echo "Jalankan dengan sudo: sudo ./secure.sh"; exit 1; fi

say "Memasang ufw, fail2ban, pembaruan otomatis"
export DEBIAN_FRONTEND=noninteractive
apt-get -qq update >/dev/null
apt-get -y -qq install ufw fail2ban python3-systemd unattended-upgrades >/dev/null

say "Firewall"
# Port SSH yang sedang dipakai (jangan sampai terkunci di luar).
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
SSH_PORT="${SSH_PORT:-22}"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw delete allow "$SSH_PORT/tcp" >/dev/null 2>&1 || true   # aturan "allow" lama akan menimpa "limit"
ufw limit "$SSH_PORT/tcp" >/dev/null           # maks. 6 koneksi baru / 30 detik per IP
# Port koneksi SSH saat ini juga dibuka bila berbeda (supaya tidak terkunci); kalau sama, biarkan aturan "limit".
CUR_PORT="$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')"
if [ -n "$CUR_PORT" ] && [ "$CUR_PORT" != "$SSH_PORT" ]; then ufw allow "$CUR_PORT/tcp" >/dev/null; fi
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
if grep -qs '^DOMAIN=.\+' .env; then ufw delete allow 8080/tcp >/dev/null 2>&1 || true; else ufw allow 8080/tcp >/dev/null; fi
ufw --force enable >/dev/null
ufw status | sed -n '1,20p'

say "fail2ban (SSH)"
cat > /etc/fail2ban/jail.d/freease.local <<'JAIL'
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
bantime.increment = true
JAIL
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban || echo "(fail2ban belum bisa jalan — cek: journalctl -u fail2ban -n 20)"

say "SSH: batasi percobaan login"
if [ -d /etc/ssh/sshd_config.d ]; then
  cat > /etc/ssh/sshd_config.d/50-freease.conf <<'SSHD'
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 10:30:60
SSHD
  if sshd -t 2>/dev/null; then systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  else rm -f /etc/ssh/sshd_config.d/50-freease.conf; echo "(dilewati: konfigurasi SSH tidak cocok)"; fi
fi

say "Kernel: perlindungan SYN flood & paket palsu"
cat > /etc/sysctl.d/99-freease.conf <<'SYSCTL'
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_synack_retries = 3
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
SYSCTL
sysctl -q --system >/dev/null 2>&1 || true

say "Pembaruan keamanan otomatis"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

printf '\n\033[1;32mVPS sudah diamankan.\033[0m  Cek IP yang diblokir: fail2ban-client status sshd\n'
