#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root"
  exit 1
fi

echo "[1/6] apt update + base packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  nginx \
  certbot \
  python3-certbot-nginx \
  jq \
  cron \
  docker.io \
  docker-compose-v2

mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

echo "[2/6] enable services"
systemctl enable --now docker
systemctl restart docker
systemctl enable --now nginx
systemctl enable --now fail2ban
systemctl enable --now cron

echo "[3/6] create swap if missing"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[4/6] firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[5/6] redis & memory kernel tuning"
cat >/etc/sysctl.d/99-telegram-vps.conf <<'EOF'
vm.overcommit_memory = 1
vm.swappiness = 60
vm.vfs_cache_pressure = 50
EOF
sysctl --system >/dev/null

mkdir -p /opt/telegram/releases /opt/telegram/shared
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/prune_vps_garbage.sh" ]]; then
  cp "${SCRIPT_DIR}/prune_vps_garbage.sh" /opt/telegram/shared/prune_vps_garbage.sh
  chmod +x /opt/telegram/shared/prune_vps_garbage.sh
  /opt/telegram/shared/prune_vps_garbage.sh --install-cron
fi

echo "[6/6] final state"
docker --version
docker compose version
free -h
swapon --show
ufw status
