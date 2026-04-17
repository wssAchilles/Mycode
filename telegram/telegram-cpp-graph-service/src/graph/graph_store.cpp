#include "graph/graph_store.h"

#include <algorithm>
#include <cmath>
#include <mutex>
#include <queue>

namespace telegram::graph::core {
namespace {

using WeightedNeighbor = GraphStore::WeightedNeighbor;

double normalized_weight(double score, double interaction_probability) {
  return std::max(0.0, score) * 0.8 + std::max(0.0, interaction_probability) * 0.2;
}

template <typename T>
void trim_sorted(std::vector<T>& values, std::size_t limit) {
  if (values.size() > limit) {
    values.resize(limit);
  }
}

}  // namespace

void GraphStore::replace_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    std::chrono::system_clock::time_point loaded_at) {
  std::unordered_map<std::string, std::vector<WeightedNeighbor>> next_adjacency;
  std::unordered_set<std::string> vertices;
  vertices.reserve(edges.size() * 2);

  for (const auto& edge : edges) {
    vertices.insert(edge.source_user_id);
    vertices.insert(edge.target_user_id);
    next_adjacency[edge.source_user_id].push_back(WeightedNeighbor{
        .user_id = edge.target_user_id,
        .score = edge.decayed_sum,
        .interaction_probability = edge.interaction_probability,
    });
  }

  for (auto& [user_id, neighbors] : next_adjacency) {
    std::sort(
        neighbors.begin(),
        neighbors.end(),
        [](const WeightedNeighbor& left, const WeightedNeighbor& right) {
          const auto left_weight = normalized_weight(left.score, left.interaction_probability);
          const auto right_weight = normalized_weight(right.score, right.interaction_probability);
          if (std::abs(left_weight - right_weight) > 1e-9) {
            return left_weight > right_weight;
          }
          return left.user_id < right.user_id;
        });
    trim_sorted(neighbors, max_neighbors_per_user);
  }

  std::unique_lock lock(mutex_);
  adjacency_ = std::move(next_adjacency);
  metadata_ = SnapshotMetadata{
      .loaded = true,
      .edge_count = edges.size(),
      .vertex_count = vertices.size(),
      .snapshot_version = snapshot_version,
      .loaded_at = loaded_at,
  };
}

std::vector<GraphStore::WeightedNeighbor> GraphStore::read_neighbors(const std::string& user_id) const {
  std::shared_lock lock(mutex_);
  const auto iterator = adjacency_.find(user_id);
  if (iterator == adjacency_.end()) {
    return {};
  }
  return iterator->second;
}

std::vector<contracts::NeighborCandidate> GraphStore::direct_neighbors(
    const std::string& user_id,
    std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  std::vector<contracts::NeighborCandidate> result;
  const auto neighbors = read_neighbors(user_id);
  for (const auto& neighbor : neighbors) {
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    result.push_back(contracts::NeighborCandidate{
        .user_id = neighbor.user_id,
        .score = neighbor.score,
        .interaction_probability = neighbor.interaction_probability,
    });
    if (result.size() >= limit) {
      break;
    }
  }
  return result;
}

std::vector<contracts::MultiHopCandidate> GraphStore::multi_hop_candidates(
    const std::string& user_id,
    std::size_t limit,
    std::size_t max_depth,
    std::size_t max_branching_factor,
    const std::unordered_set<std::string>& excluded_user_ids,
    bool exclude_direct_neighbors) const {
  const auto direct_neighbors = read_neighbors(user_id);
  if (direct_neighbors.empty()) {
    return {};
  }

  std::unordered_set<std::string> direct_neighbor_ids;
  direct_neighbor_ids.reserve(direct_neighbors.size());
  for (const auto& neighbor : direct_neighbors) {
    direct_neighbor_ids.insert(neighbor.user_id);
  }

  struct FrontierNode {
    std::string current_user_id;
    std::string first_hop_user_id;
    double accumulated_score;
    std::size_t depth;
  };

  struct AggregateCandidate {
    double score{0.0};
    std::size_t depth{0};
    std::size_t path_count{0};
    std::unordered_set<std::string> via_user_ids;
  };

  std::queue<FrontierNode> frontier;
  for (const auto& neighbor : direct_neighbors) {
    frontier.push(FrontierNode{
        .current_user_id = neighbor.user_id,
        .first_hop_user_id = neighbor.user_id,
        .accumulated_score = normalized_weight(neighbor.score, neighbor.interaction_probability),
        .depth = 1,
    });
  }

  std::unordered_map<std::string, AggregateCandidate> aggregate;
  while (!frontier.empty()) {
    const auto node = frontier.front();
    frontier.pop();

    if (node.depth >= max_depth) {
      continue;
    }

    const auto next_neighbors = read_neighbors(node.current_user_id);
    const auto branching_limit = std::min(next_neighbors.size(), max_branching_factor);
    for (std::size_t index = 0; index < branching_limit; index += 1) {
      const auto& candidate = next_neighbors[index];
      if (candidate.user_id == user_id || excluded_user_ids.contains(candidate.user_id)) {
        continue;
      }
      if (exclude_direct_neighbors && direct_neighbor_ids.contains(candidate.user_id)) {
        continue;
      }

      const auto next_depth = node.depth + 1;
      const auto path_score = node.accumulated_score * normalized_weight(candidate.score, candidate.interaction_probability);

      auto& entry = aggregate[candidate.user_id];
      entry.score += path_score;
      entry.path_count += 1;
      entry.depth = entry.depth == 0 ? next_depth : std::min(entry.depth, next_depth);
      entry.via_user_ids.insert(node.first_hop_user_id);

      if (next_depth < max_depth) {
        frontier.push(FrontierNode{
            .current_user_id = candidate.user_id,
            .first_hop_user_id = node.first_hop_user_id,
            .accumulated_score = path_score,
            .depth = next_depth,
        });
      }
    }
  }

  std::vector<contracts::MultiHopCandidate> result;
  result.reserve(aggregate.size());
  for (auto& [candidate_user_id, candidate] : aggregate) {
    std::vector<std::string> via_user_ids(candidate.via_user_ids.begin(), candidate.via_user_ids.end());
    std::sort(via_user_ids.begin(), via_user_ids.end());
    result.push_back(contracts::MultiHopCandidate{
        .user_id = candidate_user_id,
        .score = candidate.score,
        .depth = candidate.depth,
        .path_count = candidate.path_count,
        .via_user_ids = via_user_ids,
    });
  }

  std::sort(
      result.begin(),
      result.end(),
      [](const contracts::MultiHopCandidate& left, const contracts::MultiHopCandidate& right) {
        if (std::abs(left.score - right.score) > 1e-9) {
          return left.score > right.score;
        }
        if (left.depth != right.depth) {
          return left.depth < right.depth;
        }
        return left.user_id < right.user_id;
      });
  trim_sorted(result, limit);
  return result;
}

std::vector<contracts::OverlapCandidate> GraphStore::overlap_candidates(
    const std::string& user_a_id,
    const std::string& user_b_id,
    std::size_t limit) const {
  const auto neighbors_a = read_neighbors(user_a_id);
  const auto neighbors_b = read_neighbors(user_b_id);
  if (neighbors_a.empty() || neighbors_b.empty()) {
    return {};
  }

  std::unordered_map<std::string, WeightedNeighbor> lookup_a;
  lookup_a.reserve(neighbors_a.size());
  for (const auto& neighbor : neighbors_a) {
    lookup_a.emplace(neighbor.user_id, neighbor);
  }

  std::vector<contracts::OverlapCandidate> result;
  for (const auto& neighbor : neighbors_b) {
    const auto iterator = lookup_a.find(neighbor.user_id);
    if (iterator == lookup_a.end()) {
      continue;
    }
    result.push_back(contracts::OverlapCandidate{
        .user_id = neighbor.user_id,
        .combined_score = iterator->second.score + neighbor.score,
        .user_a_score = iterator->second.score,
        .user_b_score = neighbor.score,
    });
  }

  std::sort(
      result.begin(),
      result.end(),
      [](const contracts::OverlapCandidate& left, const contracts::OverlapCandidate& right) {
        if (std::abs(left.combined_score - right.combined_score) > 1e-9) {
          return left.combined_score > right.combined_score;
        }
        return left.user_id < right.user_id;
      });
  trim_sorted(result, limit);
  return result;
}

SnapshotMetadata GraphStore::metadata() const {
  std::shared_lock lock(mutex_);
  return metadata_;
}

}  // namespace telegram::graph::core
