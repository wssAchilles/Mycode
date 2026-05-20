#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace telegram::graph::snapshot {

/// BFS-based node reordering for improved cache locality.
/// Renumber nodes by BFS traversal order so that adjacent nodes in the graph
/// are stored contiguously in memory, maximizing cache-line utilization.
///
/// This is a preprocessing step that runs during snapshot construction.
template <typename NodeId>
std::unordered_map<NodeId, uint32_t> compute_bfs_order(
    const std::unordered_map<NodeId, std::vector<NodeId>>& adjacency) {
  std::unordered_map<NodeId, uint32_t> reorder_map;
  std::unordered_set<NodeId> visited;
  std::queue<NodeId> frontier;

  // Find a starting node (first node with edges, or any node)
  NodeId start{};
  bool found_start = false;
  for (const auto& [node, neighbors] : adjacency) {
    if (!neighbors.empty()) {
      start = node;
      found_start = true;
      break;
    }
  }

  if (!found_start) {
    // No edges — assign sequential order to all nodes
    uint32_t idx = 0;
    for (const auto& [node, _] : adjacency) {
      reorder_map[node] = idx++;
    }
    return reorder_map;
  }

  // BFS from the start node
  frontier.push(start);
  visited.insert(start);
  uint32_t next_id = 0;

  while (!frontier.empty()) {
    auto current = frontier.front();
    frontier.pop();
    reorder_map[current] = next_id++;

    auto it = adjacency.find(current);
    if (it != adjacency.end()) {
      for (const auto& neighbor : it->second) {
        if (visited.find(neighbor) == visited.end()) {
          visited.insert(neighbor);
          frontier.push(neighbor);
        }
      }
    }
  }

  // Handle disconnected components — assign remaining nodes
  for (const auto& [node, _] : adjacency) {
    if (reorder_map.find(node) == reorder_map.end()) {
      reorder_map[node] = next_id++;
    }
  }

  return reorder_map;
}

/// Apply reordering to a vector of node IDs.
template <typename NodeId>
std::vector<NodeId> apply_reordering(
    const std::vector<NodeId>& nodes,
    const std::unordered_map<NodeId, uint32_t>& reorder_map) {
  // Create inverse map: new_id -> old_node
  std::vector<NodeId> result(nodes.size());
  for (const auto& node : nodes) {
    auto it = reorder_map.find(node);
    if (it != reorder_map.end() && it->second < result.size()) {
      result[it->second] = node;
    }
  }
  return result;
}

}  // namespace telegram::graph::snapshot
