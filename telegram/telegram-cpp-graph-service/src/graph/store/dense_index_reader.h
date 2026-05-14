#pragma once

#include <optional>
#include <span>
#include <string>

#include "graph/snapshot/csr_index.h"

namespace telegram::graph::core::store {

template <typename SnapshotData>
auto find_source_id(const SnapshotData& snapshot, const std::string& user_id) {
  return snapshot.user_ids.find(user_id);
}

template <typename SnapshotData, typename InternerId>
std::span<const typename SnapshotData::DenseNeighborRef> read_dense_neighbor_index_by_id(
    const SnapshotData& snapshot,
    const InternerId source_id) {
  if (source_id + 1 >= snapshot.dense_source_offsets.size()) {
    return {};
  }
  return snapshot::read_csr_span(
      snapshot.dense_source_offsets,
      snapshot.dense_neighbors,
      source_id);
}

template <typename SnapshotData>
std::span<const typename SnapshotData::DenseNeighborRef> read_dense_neighbor_index(
    const SnapshotData& snapshot,
    const std::string& user_id) {
  const auto source_id = find_source_id(snapshot, user_id);
  if (!source_id.has_value()) {
    return {};
  }
  return read_dense_neighbor_index_by_id(snapshot, source_id.value());
}

template <typename SnapshotData, typename InternerId>
std::span<const typename SnapshotData::DenseNeighborRef> read_ranked_dense_neighbor_index_by_id(
    const SnapshotData& snapshot,
    const InternerId source_id) {
  if (source_id + 1 >= snapshot.dense_ranked_source_offsets.size()) {
    return {};
  }
  return snapshot::read_csr_span(
      snapshot.dense_ranked_source_offsets,
      snapshot.dense_ranked_neighbors,
      source_id);
}

template <typename SnapshotData>
std::span<const typename SnapshotData::DenseNeighborRef> read_ranked_dense_neighbor_index(
    const SnapshotData& snapshot,
    const std::string& user_id) {
  const auto source_id = find_source_id(snapshot, user_id);
  if (!source_id.has_value()) {
    return {};
  }
  return read_ranked_dense_neighbor_index_by_id(snapshot, source_id.value());
}

}  // namespace telegram::graph::core::store
