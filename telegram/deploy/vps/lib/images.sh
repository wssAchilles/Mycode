#!/usr/bin/env bash

build_image_refs() {
  local release_tag="${1:?release tag is required}"
  local backend_image="${BACKEND_IMAGE:-ghcr.io/wssachilles/mycode-telegram-backend}"
  local gateway_image="${GATEWAY_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-gateway}"
  local delivery_consumer_image="${DELIVERY_CONSUMER_IMAGE:-ghcr.io/wssachilles/mycode-telegram-go-delivery-consumer}"
  local recommendation_image="${RECOMMENDATION_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-recommendation}"
  local graph_kernel_image="${GRAPH_KERNEL_IMAGE:-ghcr.io/wssachilles/mycode-telegram-cpp-graph-service}"

  printf '%s:%s\n' "${backend_image}" "${release_tag}"
  printf '%s:%s\n' "${gateway_image}" "${release_tag}"
  printf '%s:%s\n' "${delivery_consumer_image}" "${release_tag}"
  printf '%s:%s\n' "${recommendation_image}" "${release_tag}"
  printf '%s:%s\n' "${graph_kernel_image}" "${release_tag}"
}
