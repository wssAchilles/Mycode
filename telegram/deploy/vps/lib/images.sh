#!/usr/bin/env bash

normalize_release_tag() {
  local release_tag="${1:-}"
  if [[ "${release_tag}" =~ ^[0-9a-fA-F]{8,40}$ ]]; then
    release_tag="${release_tag:0:7}"
  fi
  printf '%s\n' "${release_tag}"
}

build_image_refs() {
  local release_tag="${1:?release tag is required}"
  printf '%s:%s\n' "${BACKEND_IMAGE:-ghcr.io/wssachilles/mycode-telegram-backend}" "${release_tag}"
  printf '%s:%s\n' "${GATEWAY_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-gateway}" "${release_tag}"
  printf '%s:%s\n' "${DELIVERY_CONSUMER_IMAGE:-ghcr.io/wssachilles/mycode-telegram-go-delivery-consumer}" "${release_tag}"
  printf '%s:%s\n' "${RECOMMENDATION_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-recommendation}" "${release_tag}"
  printf '%s:%s\n' "${GRAPH_KERNEL_IMAGE:-ghcr.io/wssachilles/mycode-telegram-cpp-graph-service}" "${release_tag}"
}
