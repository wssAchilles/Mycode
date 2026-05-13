#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <memory>
#include <numeric>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "contracts/types.h"
#include "graph/ranking.h"
#include "graph/snapshot/dense_layout.h"
#include "graph/snapshot/edge_aggregation.h"
#include "graph/snapshot/metadata_builder.h"

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

  std::unordered_map<std::string, std::unordered_map<std::string, WeightedNeighbor>> grouped_adjacency;
  std::unordered_map<std::string, std::size_t> edge_kind_counts;
  std::unordered_set<std::string> vertices;
  vertices.reserve(edges.size() * 2);
  grouped_adjacency.reserve(edges.size());

  for (const auto& edge : edges) {
    vertices.insert(edge.source_user_id);
    vertices.insert(edge.target_user_id);
    (void)next_snapshot->user_ids.intern(edge.source_user_id);
    (void)next_snapshot->user_ids.intern(edge.target_user_id);

    const auto edge_kinds = edge_kinds_from_record(edge);
    for (const auto& kind : edge_kinds) {
      (void)next_snapshot->edge_kind_ids.intern(kind);
      edge_kind_counts[kind] += 1;
    }

    auto& target_map = grouped_adjacency[edge.source_user_id];
    auto iterator = target_map.find(edge.target_user_id);
    if (iterator == target_map.end()) {
      target_map.emplace(edge.target_user_id, WeightedNeighbor{
          .user_id = edge.target_user_id,
          .score = edge.decayed_sum,
          .interaction_probability = edge.interaction_probability,
          .daily_signal_counts = edge.daily_signal_counts,
          .rollup_signal_counts = edge.rollup_signal_counts,
          .edge_kinds = edge_kinds,
          .last_interaction_at_ms = edge.last_interaction_at_ms,
          .updated_at_ms = edge.updated_at_ms,
      });
      continue;
    }

    auto& existing = iterator->second;
    existing.score += edge.decayed_sum;
    existing.interaction_probability = std::max(existing.interaction_probability, edge.interaction_probability);
    existing.daily_signal_counts = add_counts(existing.daily_signal_counts, edge.daily_signal_counts);
    existing.rollup_signal_counts = add_counts(existing.rollup_signal_counts, edge.rollup_signal_counts);
    merge_edge_kinds(existing.edge_kinds, edge_kinds);
    existing.last_interaction_at_ms = max_optional(existing.last_interaction_at_ms, edge.last_interaction_at_ms);
    existing.updated_at_ms = max_optional(existing.updated_at_ms, edge.updated_at_ms);
  }

  auto& adjacency = next_snapshot->adjacency;
  adjacency.reserve(grouped_adjacency.size());
  for (auto& [source_user_id, target_map] : grouped_adjacency) {
    auto& neighbors = adjacency[source_user_id];
    neighbors.reserve(target_map.size());
    for (auto& [target_user_id, neighbor] : target_map) {
      (void)target_user_id;
      neighbors.push_back(std::move(neighbor));
    }
  }

  for (auto& [user_id, neighbors] : adjacency) {
    std::vector<double> weights(neighbors.size());
    for (std::size_t i = 0; i < neighbors.size(); ++i) {
      weights[i] = weight_fn(neighbors[i]);
    }

    std::vector<std::size_t> indices(neighbors.size());
    std::iota(indices.begin(), indices.end(), 0);
    const auto retained_count = std::min(neighbors.size(), max_neighbors_per_user);
    ranking::sort_top_k(
        indices.begin(),
        indices.end(),
        retained_count,
        [&](const std::size_t left, const std::size_t right) {
          if (std::abs(weights[left] - weights[right]) > 1e-9) {
            return weights[left] > weights[right];
          }
          return neighbors[left].user_id < neighbors[right].user_id;
        });

    std::vector<WeightedNeighbor> sorted;
    sorted.reserve(retained_count);
    for (std::size_t i = 0; i < retained_count; ++i) {
      sorted.push_back(std::move(neighbors[indices[i]]));
    }
    neighbors = std::move(sorted);

    auto& neighbor_index = next_snapshot->neighbors_by_user_id[user_id];
    neighbor_index.reserve(neighbors.size());
    for (const auto& neighbor : neighbors) {
      neighbor_index.push_back(&neighbor);
    }
    std::sort(
        neighbor_index.begin(),
        neighbor_index.end(),
        [](const WeightedNeighbor* left, const WeightedNeighbor* right) {
          return left->user_id < right->user_id;
        });
  }

  rebuild_dense_layout(*next_snapshot, adjacency);
  next_snapshot->metadata = build_metadata(
      *next_snapshot,
      edges.size(),
      vertices.size(),
      std::move(edge_kind_counts),
      snapshot_version,
      loaded_at);
  return next_snapshot;
}

}  // namespace telegram::graph::core::snapshot
