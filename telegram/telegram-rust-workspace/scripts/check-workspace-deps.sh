#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKSPACE_DIR="${PROJECT_DIR}/telegram-rust-workspace"
SERVICE_CRATE="telegram-rust-recommendation"
SERVICE_MANIFEST="${WORKSPACE_DIR}/crates/${SERVICE_CRATE}/Cargo.toml"

fail() {
  printf 'workspace dependency check failed: %s\n' "$1" >&2
  exit 1
}

[[ -f "${WORKSPACE_DIR}/Cargo.toml" ]] || fail "missing workspace Cargo.toml"
[[ -f "${SERVICE_MANIFEST}" ]] || fail "missing service Cargo.toml"

cargo metadata --manifest-path "${WORKSPACE_DIR}/Cargo.toml" --no-deps --format-version 1 >/dev/null

for manifest in "${WORKSPACE_DIR}"/crates/*/Cargo.toml; do
  crate_name="$(basename "$(dirname "${manifest}")")"
  if [[ "${crate_name}" == "${SERVICE_CRATE}" ]]; then
    continue
  fi

  if grep -Fq -- "${SERVICE_CRATE}" "${manifest}"; then
    printf '%s\n' "${manifest}" >&2
    fail "shared crates must not depend on ${SERVICE_CRATE}"
  fi
done

for manifest in "${WORKSPACE_DIR}"/crates/telegram-*-primitives/Cargo.toml; do
  crate_name="$(basename "$(dirname "${manifest}")")"
  if grep -Eq -- 'telegram-(rust-recommendation|recommendation-fixtures)\.workspace\s*=' "${manifest}"; then
    printf '%s\n' "${manifest}" >&2
    fail "primitive crate ${crate_name} must not depend on service or fixture crates"
  fi
done

if grep -R --include='*.rs' -n 'telegram_rust_recommendation' \
  "${WORKSPACE_DIR}"/crates/telegram-*-primitives/src \
  "${WORKSPACE_DIR}"/crates/telegram-recommendation-contracts/src \
  "${WORKSPACE_DIR}"/crates/telegram-recommendation-fixtures/src \
  "${WORKSPACE_DIR}"/crates/telegram-rust-http-types/src >/tmp/telegram_workspace_service_ref.txt; then
  cat /tmp/telegram_workspace_service_ref.txt >&2
  fail "shared crates must not reference telegram_rust_recommendation internals"
fi

for crate_dir in "${WORKSPACE_DIR}"/crates/telegram-*-primitives "${WORKSPACE_DIR}"/crates/telegram-recommendation-contracts "${WORKSPACE_DIR}"/crates/telegram-recommendation-fixtures "${WORKSPACE_DIR}"/crates/telegram-rust-http-types; do
  [[ -d "${crate_dir}" ]] || continue
  crate_name="$(basename "${crate_dir}")"
  if ! grep -Fq -- "${crate_name} = { path = \"crates/${crate_name}\" }" "${WORKSPACE_DIR}/Cargo.toml"; then
    fail "${crate_name} is not registered in workspace.dependencies"
  fi
done

for crate_name in \
  telegram-component-primitives \
  telegram-filter-primitives \
  telegram-pipeline-primitives \
  telegram-ranking-primitives \
  telegram-recommendation-contracts \
  telegram-recommendation-fixtures \
  telegram-runtime-primitives \
  telegram-rust-http-types \
  telegram-selector-primitives \
  telegram-serving-primitives \
  telegram-source-primitives; do
  if ! grep -Fq -- "${crate_name}.workspace = true" "${SERVICE_MANIFEST}"; then
    fail "${SERVICE_CRATE} must consume ${crate_name} through workspace dependencies"
  fi
done

if command -v rg >/dev/null 2>&1; then
  path_dep_matches() {
    rg -n 'path\s*=\s*"\.\.' "$@"
  }
else
  path_dep_matches() {
    grep -En 'path[[:space:]]*=[[:space:]]*"\.\.' "$@"
  }
fi

if path_dep_matches "${WORKSPACE_DIR}"/crates/*/Cargo.toml >/tmp/telegram_workspace_path_deps.txt; then
  cat /tmp/telegram_workspace_path_deps.txt >&2
  fail "crate manifests must use workspace dependencies instead of relative parent paths"
fi

printf 'workspace dependency check passed\n'
