#!/usr/bin/env bash
# VPS 垃圾镜像、残次容器、历史发布包与系统缓存自动清理脚本
# 用途：
#   1. 清理部署失败残留的退出/死锁容器与悬空镜像 (<none>:<none>)
#   2. 精准删除非当前运行容器所使用的历史业务镜像 (mycode-telegram-*)
#   3. 清理 Docker 构建缓存与无用网络
#   4. 清理 /opt/telegram/releases 下除 current 及最近 1 个回滚版本外的旧目录与残留压缩包
#   5. 压缩 systemd journal 日志并释放 Linux 可回收页缓存 (PageCache/dentries/inodes)
#   6. 支持 --install-cron 注册每 4 小时自动执行的定时清理任务

set -euo pipefail

REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
KEEP_RELEASES="${KEEP_RELEASES:-2}"
CRON_FILE="/etc/cron.d/telegram-prune-garbage"
LOG_FILE="/var/log/telegram-prune.log"

install_cron() {
  local script_path
  script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  mkdir -p "${REMOTE_ROOT}/shared"
  if [[ "${script_path}" != "${REMOTE_ROOT}/shared/prune_vps_garbage.sh" ]]; then
    cp "${script_path}" "${REMOTE_ROOT}/shared/prune_vps_garbage.sh"
    chmod +x "${REMOTE_ROOT}/shared/prune_vps_garbage.sh"
  fi

  cat > "${CRON_FILE}" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 */4 * * * root REMOTE_ROOT=${REMOTE_ROOT} ${REMOTE_ROOT}/shared/prune_vps_garbage.sh >> ${LOG_FILE} 2>&1
EOF
  chmod 0644 "${CRON_FILE}"
  printf '[prune] 已安装定期清理任务: %s (每 4 小时自动清理)\n' "${CRON_FILE}"
}

if [[ "${1:-}" == "--install-cron" ]]; then
  install_cron
  shift
fi

printf '[prune] ===== 开始执行 VPS 垃圾镜像与内存空间清理 (%s) =====\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
printf '[prune] 清理前磁盘与内存状态:\n'
df -h / || true
free -h || true

if command -v docker >/dev/null 2>&1; then
  # 1. 清理所有已退出、创建失败或死锁的容器
  printf '[prune] 清理失败/已退出容器...\n'
  docker container prune -f || true

  # 2. 清理悬空 (dangling) 残次镜像层
  printf '[prune] 清理悬空残次镜像...\n'
  docker image prune -f || true

  # 3. 精准清理未被当前运行容器使用的历史业务镜像 (mycode-telegram-* 等)
  active_image_ids="$(docker ps -q | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null | sort -u || true)"
  while IFS= read -r img_line; do
    [[ -z "${img_line}" ]] && continue
    img_ref="${img_line%% *}"
    img_id="${img_line#* }"
    if [[ -n "${active_image_ids}" ]] && grep -Fq "${img_id}" <<<"${active_image_ids}"; then
      continue
    fi
    printf '[prune] 移除未使用的历史/残次镜像: %s (%s)\n' "${img_ref}" "${img_id:0:19}"
    docker rmi -f "${img_ref}" >/dev/null 2>&1 || docker rmi -f "${img_id}" >/dev/null 2>&1 || true
  done < <(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E 'mycode-telegram-|<none>' || true)

  # 4. 清理超过 1 小时的其它无用基础镜像、构建缓存与无用网络
  docker image prune -af --filter "until=1h" >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
fi

# 5. 清理残留的发布压缩包与历史 release 目录（保留 current 指向目录及最近 1 个备份）
if [[ -d "${REMOTE_ROOT}" ]]; then
  rm -f "${REMOTE_ROOT}"/release-*.tar.gz
  if [[ -d "${REMOTE_ROOT}/releases" ]]; then
    current_target=""
    if [[ -L "${REMOTE_ROOT}/current" ]]; then
      current_target="$(readlink -f "${REMOTE_ROOT}/current" || true)"
    fi

    mapfile -t release_dirs < <(ls -1dt "${REMOTE_ROOT}/releases"/* 2>/dev/null || true)
    kept=0
    for dir in "${release_dirs[@]}"; do
      [[ -z "${dir}" || ! -d "${dir}" ]] && continue
      real_dir="$(readlink -f "${dir}" || echo "${dir}")"
      if [[ -n "${current_target}" && "${real_dir}" == "${current_target}" ]]; then
        kept=$((kept + 1))
        continue
      fi
      if (( kept < KEEP_RELEASES )); then
        kept=$((kept + 1))
        continue
      fi
      printf '[prune] 删除过期历史发布目录: %s\n' "${dir}"
      rm -rf "${dir}"
    done
  fi
fi

# 6. 清理系统日志与 apt 缓存
if command -v journalctl >/dev/null 2>&1; then
  journalctl --vacuum-time=3d --vacuum-size=100M >/dev/null 2>&1 || true
fi
if command -v apt-get >/dev/null 2>&1; then
  apt-get clean >/dev/null 2>&1 || true
fi

# 7. 同步磁盘并释放 Linux 可回收 PageCache/dentries/inodes，回收可用物理内存
if [[ -w /proc/sys/vm/drop_caches ]]; then
  sync
  echo 3 > /proc/sys/vm/drop_caches || true
fi

printf '[prune] 清理后磁盘与内存状态:\n'
df -h / || true
free -h || true
printf '[prune] ===== 清理完成 =====\n'
