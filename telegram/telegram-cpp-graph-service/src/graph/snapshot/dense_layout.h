#pragma once

#include <algorithm>
#include <vector>

#include "graph/snapshot/csr_index.h"

namespace telegram::graph::core::snapshot {

template <typename SnapshotData, typename Adjacency>
void rebuild_dense_layout(SnapshotData& snapshot, Adjacency& adjacency) {
  using DenseNeighborRef = typename SnapshotData::DenseNeighborRef;

  std::vector<std::vector<DenseNeighborRef>> dense_by_source(snapshot.user_ids.size());
  std::vector<std::vector<DenseNeighborRef>> dense_ranked_by_source(snapshot.user_ids.size());
  for (auto& [user_id, neighbors] : adjacency) {
    const auto source_id = snapshot.user_ids.find(user_id);
    if (!source_id.has_value()) {
      continue;
    }
    auto& dense_neighbors = dense_by_source[source_id.value()];
    auto& dense_ranked_neighbors = dense_ranked_by_source[source_id.value()];
    dense_neighbors.reserve(neighbors.size());
    dense_ranked_neighbors.reserve(neighbors.size());
    for (const auto& neighbor : neighbors) {
      const auto target_id = snapshot.user_ids.find(neighbor.user_id);
      if (!target_id.has_value()) {
        continue;
      }
      const auto ref = DenseNeighborRef{
          .target_id = target_id.value(),
          .neighbor = &neighbor,
      };
      dense_neighbors.push_back(ref);
      dense_ranked_neighbors.push_back(ref);
    }
    std::sort(
        dense_neighbors.begin(),
        dense_neighbors.end(),
        [](const DenseNeighborRef& left, const DenseNeighborRef& right) {
          return left.target_id < right.target_id;
        });
  }

  flatten_csr_index(dense_by_source, snapshot.dense_source_offsets, snapshot.dense_neighbors);
  flatten_csr_index(
      dense_ranked_by_source,
      snapshot.dense_ranked_source_offsets,
      snapshot.dense_ranked_neighbors);
}

}  // namespace telegram::graph::core::snapshot
