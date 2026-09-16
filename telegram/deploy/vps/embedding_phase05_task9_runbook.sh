#!/usr/bin/env bash
# Embedding Phase 0.5 Task 9 production runbook (DRAFT — operator only).
#
# 状态：本脚本默认 DRY-RUN 打印步骤，绝不执行 Mongo 写、缓存删除或 verify_all.sh。
# 要真正执行，必须：
#   1. 设置 TASK9_EXECUTE=1
#   2. 提供 plan 规定的全部外部授权 artifact 路径
#   3. 由 operator 在控制台逐步确认
#
# 依据：
#   docs/superpowers/plans/2026-07-16-phase0.5-authorization-completion.md §5
#   docs/superpowers/plans/2026-07-13-recommendation-embedding-contract-remediation.md Task 9
#   telegram-clone-backend/src/services/ops/recommendation/embeddingRepair/authorization.ts
#
# 安全假设（必须接受）：
#   - approval/authorization/pause 文件带外可信、无数字签名
#   - writer pause 覆盖全部可写路径（含 Python feature refresh）
#   - Mongo snapshot ≠ PostgreSQL 一致性
#   - SHA-256 抗碰撞 + 规范化编码无歧义
#   - 非恶意运维；主机时钟大致同步
#   - pause 窗口内集合不再插入新文档
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${REPORT_DIR:-${ROOT_DIR}/reports/recommendation/embedding-contract-remediation}"
BACKEND_DIR="${ROOT_DIR}/telegram-clone-backend"

TASK9_EXECUTE="${TASK9_EXECUTE:-0}"
APPLY_PROPOSAL_FILE="${APPLY_PROPOSAL_FILE:-}"
APPLY_BACKUP_FILE="${APPLY_BACKUP_FILE:-}"
APPLY_PROPOSAL_APPROVAL="${APPLY_PROPOSAL_APPROVAL:-}"
APPLY_BACKUP_APPROVAL="${APPLY_BACKUP_APPROVAL:-}"
APPLY_PRODUCTION_AUTH="${APPLY_PRODUCTION_AUTH:-}"
APPLY_WRITER_PAUSE_EVIDENCE="${APPLY_WRITER_PAUSE_EVIDENCE:-}"
APPROVED_PROPOSAL_DIGEST="${APPROVED_PROPOSAL_DIGEST:-}"
APPROVED_BACKUP_DIGEST="${APPROVED_BACKUP_DIGEST:-}"
APPROVED_QUARANTINE_DIGEST="${APPROVED_QUARANTINE_DIGEST:-}"

log() { printf '[task9] %s\n' "$*"; }
die() { printf '[task9][FATAL] %s\n' "$*" >&2; exit 1; }

require_file() {
  local path="${1:?path}"
  local label="${2:-file}"
  [[ -f "${path}" ]] || die "${label} missing: ${path}"
}

require_hex64() {
  local value="${1:?value}"
  local label="${2:-digest}"
  [[ "${value}" =~ ^[0-9a-f]{64}$ ]] || die "${label} must be lowercase 64-hex"
}

step_banner() {
  printf '\n=== %s ===\n' "$*"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
step_banner "0. Preflight"
log "ROOT_DIR=${ROOT_DIR}"
log "REPORT_DIR=${REPORT_DIR}"
log "TASK9_EXECUTE=${TASK9_EXECUTE} (0=dry-run print only)"

require_file "${REPORT_DIR}/authorization-packet.md" "authorization-packet"
if grep -q 'Phase 0.5 gate complete: YES' "${REPORT_DIR}/authorization-packet.md"; then
  log "packet already reports Phase 0.5 gate complete: YES — abort re-apply"
  exit 0
fi
log "packet state: $(grep -E 'Readiness:|Production authorization:|Task 9:|Phase 0.5 gate' "${REPORT_DIR}/authorization-packet.md" | tr '\n' ' | ')"

# ---------------------------------------------------------------------------
# 1. Authorization artifacts (operator-supplied)
# ---------------------------------------------------------------------------
step_banner "1. Load authorization artifacts"
if [[ -z "${APPLY_PRODUCTION_AUTH}" ]]; then
  cat <<'EOF'
尚未提供生产授权文件。Task 9 需要（路径通过环境变量传入）：

  APPLY_PRODUCTION_AUTH          apply-production-authorization.json
  APPLY_WRITER_PAUSE_EVIDENCE    writer-pause-evidence.json
  APPLY_PROPOSAL_FILE            post-pause-proposal.json
  APPLY_BACKUP_FILE              metadata-backup.json
  APPLY_PROPOSAL_APPROVAL        proposal-approval.json
  APPLY_BACKUP_APPROVAL          backup-approval.json
  APPROVED_PROPOSAL_DIGEST       外部已批 proposal digest
  APPROVED_BACKUP_DIGEST         外部已批 backup digest
  APPROVED_QUARANTINE_DIGEST     外部已批 quarantine digest（与 packet 一致）

并另备 rollback 授权（失败时独立签发）：
  ROLLBACK_PRODUCTION_AUTH / ROLLBACK_BACKUP_FILE / ROLLBACK_APPROVAL 等

本脚本在 TASK9_EXECUTE=0 时只打印 SOP，不读写生产。
EOF
else
  require_file "${APPLY_PRODUCTION_AUTH}" "production-auth"
  require_file "${APPLY_WRITER_PAUSE_EVIDENCE}" "writer-pause"
  require_file "${APPLY_PROPOSAL_FILE}" "proposal"
  require_file "${APPLY_BACKUP_FILE}" "backup"
  require_file "${APPLY_PROPOSAL_APPROVAL}" "proposal-approval"
  require_file "${APPLY_BACKUP_APPROVAL}" "backup-approval"
  require_hex64 "${APPROVED_PROPOSAL_DIGEST}" "approved proposal digest"
  require_hex64 "${APPROVED_BACKUP_DIGEST}" "approved backup digest"
  require_hex64 "${APPROVED_QUARANTINE_DIGEST}" "approved quarantine digest"
  log "authorization artifacts present"
fi

# ---------------------------------------------------------------------------
# 2. SOP checklist (always printed)
# ---------------------------------------------------------------------------
step_banner "2. Operator SOP checklist (manual / external)"
cat <<'EOF'
[ ] 2.1 Deploy clobber-fix to EVERY Node writer; prove no old instance can write UserFeatureVector
[ ] 2.2 Pause Node daily refresh + FeatureExportJob
[ ] 2.3 Pause Python feature refresh writer WITHOUT modifying Python source
[ ] 2.4 Confirm chronology: pauseAt <= approvalAt <= authorizedAt <= expiresAt
[ ] 2.5 Re-run FULL dry-run after pause → post-pause proposal
[ ] 2.6 Independent review of post-pause proposal + backup (no self-approval)
[ ] 2.7 Bind APPROVED_* digests from external review only

Cache keys authorized for deletion AFTER successful apply (never FLUSHDB):
  fcs:emb:*
  sc:embed:*
Then roll Node serving processes OR wait > L1 TTL (60s) before post-checks.

Do NOT restore Python feature refresh writer in this phase.
EOF

# ---------------------------------------------------------------------------
# 3. Apply path (gated)
# ---------------------------------------------------------------------------
step_banner "3. Apply (metadata-only)"
if [[ "${TASK9_EXECUTE}" != "1" ]]; then
  cat <<'EOF'
TASK9_EXECUTE!=1 — 跳过实际 apply。

真实执行时使用 backend CLI（示意，以 package.json scripts 为准）：

  npm --prefix telegram-clone-backend run backfill:embedding-contracts -- \
    --apply \
    --proposal-file "$APPLY_PROPOSAL_FILE" \
    --approved-proposal-digest "$APPROVED_PROPOSAL_DIGEST" \
    --approved-quarantine-digest "$APPROVED_QUARANTINE_DIGEST" \
    --backup-file "$APPLY_BACKUP_FILE" \
    --approved-backup-digest "$APPROVED_BACKUP_DIGEST" \
    --production-authorization "$APPLY_PRODUCTION_AUTH" \
    --writer-pause-evidence "$APPLY_WRITER_PAUSE_EVIDENCE" \
    --proposal-approval "$APPLY_PROPOSAL_APPROVAL" \
    --backup-approval "$APPLY_BACKUP_APPROVAL"

程序内保证：digest 不匹配或向量漂移 ⇒ writeCounters 全 0；禁止向量字段。
EOF
else
  die "TASK9_EXECUTE=1 分支需 operator 在受控终端逐步执行；本草稿脚本故意不自动串联生产写。请按 §3 注释手工调用 CLI，并逐步记录 exit code。"
fi

# ---------------------------------------------------------------------------
# 4. Post-checks (gated)
# ---------------------------------------------------------------------------
step_banner "4. Post-apply checks"
cat <<'EOF'
[ ] 4.1 Full strict audit exit 0 with approved quarantine digest
      npm --prefix telegram-clone-backend run audit:embedding-contracts -- \
        --strict --approved-quarantine-digest "$APPROVED_QUARANTINE_DIGEST"
[ ] 4.2 唯一一次 Phase 0.5 verify_all.sh（需 APPROVED_EMBEDDING_QUARANTINE_DIGEST）
[ ] 4.3 任一步失败 ⇒ 独立授权的 metadata-only rollback + 缓存失效 + 只读 audit 落盘
[ ] 4.4 双 gate 通过后才恢复已批准 Node jobs
[ ] 4.5 更新 authorization-packet: Phase 0.5 gate complete: YES
EOF

log "runbook dry-run complete — no production side effects"
