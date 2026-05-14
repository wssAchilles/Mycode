#pragma once

#include <algorithm>
#include <string>
#include <unordered_map>
#include <vector>

namespace telegram::graph::core::snapshot::build {

template <typename WeightedNeighbor>
using GroupedAdjacency = std::unordered_map<std::string, std::unordered_map<std::string, WeightedNeighbor>>;

template <typename Adjacency, typename WeightedNeighbor>
void populate_adjacency(
    Adjacency& adjacency,
    GroupedAdjacency<WeightedNeighbor>& grouped_adjacency) {
  adjacency.reserve(grouped_adjacency.size());
  for (auto& [source_user_id, target_map] : grouped_adjacency) {
    auto& neighbors = adjacency[source_user_id];
    neighbors.reserve(target_map.size());
    for (auto& [target_user_id, neighbor] : target_map) {
      (void)target_user_id;
      neighbors.push_back(std::move(neighbor));
    }
  }
}

template <typename SnapshotData, typename Adjacency>
void rebuild_neighbor_pointer_index(SnapshotData& snapshot, Adjacency& adjacency) {
  snapshot.neighbors_by_user_id.clear();
  snapshot.neighbors_by_user_id.reserve(adjacency.size());
  for (auto& [user_id, neighbors] : adjacency) {
    auto& neighbor_index = snapshot.neighbors_by_user_id[user_id];
    neighbor_index.reserve(neighbors.size());
    for (const auto& neighbor : neighbors) {
      neighbor_index.push_back(&neighbor);
    }
    std::sort(
        neighbor_index.begin(),
        neighbor_index.end(),
        [](const auto* left, const auto* right) {
          return left->user_id < right->user_id;
        });
  }
}

}  // namespace telegram::graph::core::snapshot::build
