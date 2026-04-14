#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root"
  exit 1
fi

echo "[1/5] apt update + base packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  nginx \
  docker.io \
  docker-compose-v2

echo "[2/5] enable services"
systemctl enable --now docker
systemctl enable --now nginx
systemctl enable --now fail2ban

echo "[3/5] create swap if missing"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[4/5] firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[5/6] redis kernel tuning"
cat >/etc/sysctl.d/99-telegram-vps.conf <<'EOF'
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

echo "[6/6] final state"
docker --version
docker compose version
free -h
swapon --show
ufw status
