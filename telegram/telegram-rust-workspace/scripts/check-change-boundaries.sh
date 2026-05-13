#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() {
  printf 'change boundary check failed: %s\n' "$1" >&2
  exit 1
}

if ! git -C "${PROJECT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'change boundary check skipped: not inside a git worktree\n'
  exit 0
fi

changed_paths="$(
  {
    git -C "${PROJECT_DIR}" diff --name-only --cached --diff-filter=ACMRTUXB
    git -C "${PROJECT_DIR}" diff --name-only --diff-filter=ACMRTUXB
    git -C "${PROJECT_DIR}" ls-files --others --exclude-standard
  } | sort -u
)"

if [[ -z "${changed_paths}" ]]; then
  printf 'change boundary check passed\n'
  exit 0
fi

if printf '%s\n' "${changed_paths}" | rg -n '^(telegram/)?(ml-services|telegram-light-jobs)/' >/tmp/telegram_forbidden_stage_paths.txt; then
  cat /tmp/telegram_forbidden_stage_paths.txt >&2
  fail "current recommendation phase must not modify ml-services/** or telegram-light-jobs/**"
fi

printf 'change boundary check passed\n'
