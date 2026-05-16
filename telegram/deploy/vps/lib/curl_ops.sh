#!/usr/bin/env bash

curl_ops_json() {
  local url="${1:?url is required}"
  local token="${2:-}"
  if [[ -n "${token}" ]]; then
    curl --silent --show-error --fail -H "x-ops-token: ${token}" "${url}"
  else
    curl --silent --show-error --fail "${url}"
  fi
}
