#pragma once

#include <chrono>
#include <cstddef>
#include <string>
#include <unordered_map>

#include "graph/snapshot/csr_index.h"
#include "graph/snapshot/metadata.h"
#include "graph/snapshot/memory_estimator.h"

namespace telegram::graph::core::snapshot {

template <typename SnapshotData>
std::size_t estimate_snapshot_memory_bytes(
    const SnapshotData& snapshot,
    const std::unordered_map<std::string, std::size_t>& edge_kind_counts,
    const std::size_t user_interner_memory_bytes,
    const std::size_t edge_kind_interner_memory_bytes,
    const std::size_t csr_memory_estimate_bytes,
    const std::size_t ranked_csr_memory_estimate_bytes) {
  std::size_t total = sizeof(SnapshotData);
  for (const auto& [user_id, neighbors] : snapshot.adjacency) {
    total += string_capacity_bytes(user_id);
    total += vector_storage_bytes(neighbors);
    for (const auto& neighbor : neighbors) {
      total += string_capacity_bytes(neighbor.user_id);
      total += string_vector_storage_bytes(neighbor.edge_kinds);
    }
  }
  for (const auto& [user_id, index] : snapshot.neighbors_by_user_id) {
    total += string_capacity_bytes(user_id);
    total += vector_storage_bytes(index);
  }
  for (const auto& [kind, count] : edge_kind_counts) {
    (void)count;
    total += string_capacity_bytes(kind) + sizeof(std::size_t);
  }
  total += user_interner_memory_bytes;
  total += edge_kind_interner_memory_bytes;
  total += csr_memory_estimate_bytes;
  total += ranked_csr_memory_estimate_bytes;
  return total;
}

template <typename SnapshotData>
SnapshotMetadata build_metadata(
    const SnapshotData& snapshot,
    const std::size_t edge_count,
    const std::size_t vertex_count,
    const std::size_t max_neighbors_per_user,
    std::unordered_map<std::string, std::size_t> edge_kind_counts,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at,
    std::unordered_map<std::string, std::uint64_t> build_phase_duration_ms = {}) {
  const auto user_interner_memory_bytes = snapshot.user_ids.memory_estimate_bytes();
  const auto edge_kind_interner_memory_bytes = snapshot.edge_kind_ids.memory_estimate_bytes();
  const auto csr_memory_estimate = csr_memory_estimate_bytes(
      snapshot.dense_source_offsets,
      snapshot.dense_neighbors);
  const auto ranked_csr_memory_estimate = csr_memory_estimate_bytes(
      snapshot.dense_ranked_source_offsets,
      snapshot.dense_ranked_neighbors);
  const auto interner_memory_estimate = user_interner_memory_bytes + edge_kind_interner_memory_bytes;

  return SnapshotMetadata{
      .loaded = true,
      .edge_count = edge_count,
      .vertex_count = vertex_count,
      .dense_vertex_count = snapshot.user_ids.size(),
      .interned_edge_kind_count = snapshot.edge_kind_ids.size(),
      .interner_memory_estimate_bytes = interner_memory_estimate,
      .csr_source_count = snapshot.dense_source_offsets.empty() ? 0 : snapshot.dense_source_offsets.size() - 1,
      .csr_neighbor_count = snapshot.dense_neighbors.size(),
      .csr_memory_estimate_bytes = csr_memory_estimate,
      .ranked_csr_neighbor_count = snapshot.dense_ranked_neighbors.size(),
      .ranked_csr_memory_estimate_bytes = ranked_csr_memory_estimate,
      .memory_estimate_bytes = estimate_snapshot_memory_bytes(
          snapshot,
          edge_kind_counts,
          user_interner_memory_bytes,
          edge_kind_interner_memory_bytes,
          csr_memory_estimate,
          ranked_csr_memory_estimate),
      .max_neighbors_per_user = max_neighbors_per_user,
      .compact_snapshot_enabled = true,
      .layout_version = "adjacency-v3-interned-csr",
      .snapshot_representation = "compact-csr",
      .snapshot_version = snapshot_version,
      .build_phase_duration_ms = std::move(build_phase_duration_ms),
      .edge_kind_counts = std::move(edge_kind_counts),
      .loaded_at = loaded_at,
  };
}

}  // namespace telegram::graph::core::snapshot
