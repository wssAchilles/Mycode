#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FILE="${1:?output file is required}"
shift
IMAGE_REFS=("$@")

mkdir -p "$(dirname "${OUTPUT_FILE}")"

if ! command -v docker >/dev/null 2>&1; then
  python3 - "${OUTPUT_FILE}" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "capability": "image_manifests",
    "currentBlocker": "docker_missing",
    "recommendedAction": "install_docker_or_disable_manifest_check",
    "readinessState": "blocked",
    "images": [],
}, indent=2, sort_keys=True) + "\n")
PY
  exit 1
fi

missing=()
present=()
for image_ref in "${IMAGE_REFS[@]}"; do
  if docker manifest inspect "${image_ref}" >/dev/null; then
    present+=("${image_ref}")
  else
    missing+=("${image_ref}")
  fi
done

python3 - "${OUTPUT_FILE}" "${#missing[@]}" "${present[@]}" -- "${missing[@]}" <<'PY'
import json
import sys
from pathlib import Path

output = Path(sys.argv[1])
missing_count = int(sys.argv[2])
separator_index = sys.argv.index("--")
present = sys.argv[3:separator_index]
missing = sys.argv[separator_index + 1:]
blocked = missing_count > 0
output.write_text(json.dumps({
    "capability": "image_manifests",
    "currentBlocker": "image_manifest_missing" if blocked else "none",
    "recommendedAction": "wait_for_ghcr_build_or_fix_image_tag" if blocked else "image_manifests_ready",
    "readinessState": "blocked" if blocked else "ready",
    "images": {
        "present": present,
        "missing": missing,
    },
}, indent=2, sort_keys=True) + "\n")
sys.exit(1 if blocked else 0)
PY
