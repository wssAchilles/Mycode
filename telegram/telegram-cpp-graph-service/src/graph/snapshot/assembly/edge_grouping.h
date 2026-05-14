#pragma once

#include <algorithm>
#include <cstddef>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>

#include "contracts/types.h"
#include "graph/snapshot/edge_aggregation.h"

namespace telegram::graph::core::snapshot::build {

template <typename WeightedNeighbor>
struct GroupedEdges {
  std::unordered_map<std::string, std::unordered_map<std::string, WeightedNeighbor>> adjacency;
  std::unordered_map<std::string, std::size_t> edge_kind_counts;
  std::unordered_set<std::string> vertices;
};

template <typename SnapshotData, typename WeightedNeighbor>
GroupedEdges<WeightedNeighbor> group_edges(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    SnapshotData& snapshot) {
  GroupedEdges<WeightedNeighbor> result;
  result.vertices.reserve(edges.size() * 2);
  result.adjacency.reserve(edges.size());

  for (const auto& edge : edges) {
    result.vertices.insert(edge.source_user_id);
    result.vertices.insert(edge.target_user_id);
    (void)snapshot.user_ids.intern(edge.source_user_id);
    (void)snapshot.user_ids.intern(edge.target_user_id);

    const auto edge_kinds = edge_kinds_from_record(edge);
    for (const auto& kind : edge_kinds) {
      (void)snapshot.edge_kind_ids.intern(kind);
      result.edge_kind_counts[kind] += 1;
    }

    auto& target_map = result.adjacency[edge.source_user_id];
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

  return result;
}

}  // namespace telegram::graph::core::snapshot::build
