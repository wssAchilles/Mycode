#pragma once

#include <chrono>
#include <cstddef>
#include <memory>
#include <string>
#include <vector>

#include "contracts/types.h"
#include "graph/snapshot/assembly/edge_grouping.h"
#include "graph/snapshot/assembly/neighbor_index.h"
#include "graph/snapshot/assembly/neighbor_retention.h"
#include "graph/snapshot/dense_layout.h"
#include "graph/snapshot/metadata_builder.h"
#include "graph/snapshot/node_reordering.h"

namespace telegram::graph::core::snapshot {

template <typename SnapshotData, typename WeightedNeighbor, typename WeightFn>
std::shared_ptr<SnapshotData> build_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at,
    WeightFn weight_fn) {
  auto next_snapshot = std::make_shared<SnapshotData>();
  next_snapshot->user_ids.reserve(edges.size() * 2);
  next_snapshot->edge_kind_ids.reserve(edges.size());

  auto grouped = build::group_edges<SnapshotData, WeightedNeighbor>(edges, *next_snapshot);
  auto& adjacency = next_snapshot->adjacency;
  build::populate_adjacency(adjacency, grouped.adjacency);
  build::retain_top_neighbors_per_source(adjacency, max_neighbors_per_user, weight_fn);
  build::rebuild_neighbor_pointer_index(*next_snapshot, adjacency);

  rebuild_dense_layout(*next_snapshot, adjacency);
  next_snapshot->metadata = build_metadata(
      *next_snapshot,
      edges.size(),
      grouped.vertices.size(),
      std::move(grouped.edge_kind_counts),
      snapshot_version,
      loaded_at);
  return next_snapshot;
}

}  // namespace telegram::graph::core::snapshot
