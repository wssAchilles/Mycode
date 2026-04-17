#include "graph/graph_store.h"

#include <algorithm>
#include <cmath>
#include <mutex>
#include <queue>

namespace telegram::graph::core {
namespace {

using WeightedNeighbor = GraphStore::WeightedNeighbor;

double clamp_non_negative(const double value) {
  return std::max(0.0, value);
}

double positive_engagement(const contracts::EdgeSignalCounts& counts) {
  return counts.follow_count * 4.0 + counts.reply_count * 3.0 + counts.mention_count * 2.5 +
         counts.like_count * 1.0 + counts.retweet_count * 1.5 + counts.quote_count * 1.8 +
         counts.profile_view_count * 0.2 + counts.tweet_click_count * 0.1 +
         counts.dwell_time_ms * 0.0005;
}

double negative_penalty(const contracts::EdgeSignalCounts& counts) {
  return counts.mute_count * 4.0 + counts.block_count * 8.0 + counts.report_count * 6.0;
}

double follow_bonus(const contracts::EdgeSignalCounts& counts) {
  return counts.follow_count > 0 ? 2.0 : 0.0;
}

double recentness_signal(const std::optional<std::int64_t>& last_interaction_at_ms) {
  if (!last_interaction_at_ms.has_value()) {
    return 0.0;
  }

  const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::system_clock::now().time_since_epoch())
                          .count();
  const auto elapsed_ms = std::max<std::int64_t>(0, now_ms - last_interaction_at_ms.value());
  const auto elapsed_days = static_cast<double>(elapsed_ms) / (1000.0 * 60.0 * 60.0 * 24.0);
  return std::exp(-elapsed_days / 7.0);
}

double normalized_weight(const WeightedNeighbor& neighbor) {
  const auto base_score = clamp_non_negative(neighbor.score) * 0.6;
  const auto probability_score = clamp_non_negative(neighbor.interaction_probability) * 0.15;
  const auto engagement_score =
      std::min(1.5, positive_engagement(neighbor.rollup_signal_counts) / 20.0) * 0.2;
  const auto recency_score = recentness_signal(neighbor.last_interaction_at_ms) * 0.05;
  const auto penalty = std::min(0.45, negative_penalty(neighbor.rollup_signal_counts) * 0.02);
  return std::max(0.0, base_score + probability_score + engagement_score + recency_score - penalty);
}

double social_weight(const WeightedNeighbor& neighbor) {
  const auto engagement_score = positive_engagement(neighbor.rollup_signal_counts);
  const auto relation_score = follow_bonus(neighbor.rollup_signal_counts) +
                              neighbor.rollup_signal_counts.reply_count * 0.8 +
                              neighbor.rollup_signal_counts.mention_count * 0.5;
  const auto recency_score = recentness_signal(neighbor.last_interaction_at_ms);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      neighbor.score * 0.55 + neighbor.interaction_probability * 0.15 +
          std::min(3.0, engagement_score / 12.0) + relation_score + recency_score * 0.5 - penalty);
}

double recent_engager_weight(const WeightedNeighbor& neighbor) {
  const auto recency = recentness_signal(neighbor.last_interaction_at_ms);
  const auto daily_engagement =
      neighbor.daily_signal_counts.reply_count * 2.0 + neighbor.daily_signal_counts.mention_count * 1.5 +
      neighbor.daily_signal_counts.like_count * 0.6 + neighbor.daily_signal_counts.tweet_click_count * 0.15 +
      neighbor.daily_signal_counts.dwell_time_ms * 0.0008;
  const auto rollup_engagement = positive_engagement(neighbor.rollup_signal_counts);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      recency * 2.0 + std::min(2.0, daily_engagement / 5.0) + std::min(2.0, rollup_engagement / 15.0) +
          neighbor.score * 0.25 + neighbor.interaction_probability * 0.15 - penalty);
}

std::vector<std::string> relation_kinds(const WeightedNeighbor& neighbor) {
  std::vector<std::string> kinds;
  if (neighbor.rollup_signal_counts.follow_count > 0) {
    kinds.emplace_back("follow");
  }
  if (neighbor.rollup_signal_counts.reply_count > 0) {
    kinds.emplace_back("reply");
  }
  if (neighbor.rollup_signal_counts.mention_count > 0) {
    kinds.emplace_back("mention");
  }
  if (neighbor.rollup_signal_counts.like_count > 0) {
    kinds.emplace_back("like");
  }
  if (neighbor.rollup_signal_counts.retweet_count > 0 || neighbor.rollup_signal_counts.quote_count > 0) {
    kinds.emplace_back("share");
  }
  if (neighbor.rollup_signal_counts.profile_view_count > 0 ||
      neighbor.rollup_signal_counts.tweet_click_count > 0) {
    kinds.emplace_back("interest");
  }
  if (neighbor.daily_signal_counts.reply_count > 0 || neighbor.daily_signal_counts.like_count > 0 ||
      neighbor.daily_signal_counts.mention_count > 0) {
    kinds.emplace_back("recent_activity");
  }

  std::sort(kinds.begin(), kinds.end());
  kinds.erase(std::unique(kinds.begin(), kinds.end()), kinds.end());
  return kinds;
}

double bridge_strength(const contracts::MultiHopCandidate& candidate) {
  const auto via_diversity = std::log1p(static_cast<double>(candidate.via_user_ids.size()));
  const auto path_density = std::log1p(static_cast<double>(candidate.path_count));
  const auto depth_discount = candidate.depth == 0 ? 1.0 : (1.0 / static_cast<double>(candidate.depth));
  return candidate.score * (1.0 + via_diversity * 0.35 + path_density * 0.25) * depth_discount;
}

template <typename T>
void trim_sorted(std::vector<T>& values, const std::size_t limit) {
  if (values.size() > limit) {
    values.resize(limit);
  }
}

}  // namespace

void GraphStore::replace_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at) {
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
        .daily_signal_counts = edge.daily_signal_counts,
        .rollup_signal_counts = edge.rollup_signal_counts,
        .last_interaction_at_ms = edge.last_interaction_at_ms,
        .updated_at_ms = edge.updated_at_ms,
    });
  }

  for (auto& [user_id, neighbors] : next_adjacency) {
    std::sort(
        neighbors.begin(),
        neighbors.end(),
        [](const WeightedNeighbor& left, const WeightedNeighbor& right) {
          const auto left_weight = normalized_weight(left);
          const auto right_weight = normalized_weight(right);
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
    const std::size_t limit,
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
        .engagement_score = positive_engagement(neighbor.rollup_signal_counts),
        .recentness_score = recentness_signal(neighbor.last_interaction_at_ms),
        .relation_kinds = relation_kinds(neighbor),
    });
    if (result.size() >= limit) {
      break;
    }
  }
  return result;
}

std::vector<contracts::NeighborCandidate> GraphStore::social_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto neighbors = read_neighbors(user_id);
  std::vector<WeightedNeighbor> filtered;
  filtered.reserve(neighbors.size());

  for (const auto& neighbor : neighbors) {
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    filtered.push_back(neighbor);
  }

  std::sort(
      filtered.begin(),
      filtered.end(),
      [](const WeightedNeighbor& left, const WeightedNeighbor& right) {
        const auto left_weight = social_weight(left);
        const auto right_weight = social_weight(right);
        if (std::abs(left_weight - right_weight) > 1e-9) {
          return left_weight > right_weight;
        }
        return left.user_id < right.user_id;
      });
  trim_sorted(filtered, limit);

  std::vector<contracts::NeighborCandidate> result;
  result.reserve(filtered.size());
  for (const auto& neighbor : filtered) {
    result.push_back(contracts::NeighborCandidate{
        .user_id = neighbor.user_id,
        .score = social_weight(neighbor),
        .interaction_probability = neighbor.interaction_probability,
        .engagement_score = positive_engagement(neighbor.rollup_signal_counts),
        .recentness_score = recentness_signal(neighbor.last_interaction_at_ms),
        .relation_kinds = relation_kinds(neighbor),
    });
  }
  return result;
}

std::vector<contracts::NeighborCandidate> GraphStore::recent_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto neighbors = read_neighbors(user_id);
  std::vector<WeightedNeighbor> filtered;
  filtered.reserve(neighbors.size());

  for (const auto& neighbor : neighbors) {
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    filtered.push_back(neighbor);
  }

  std::sort(
      filtered.begin(),
      filtered.end(),
      [](const WeightedNeighbor& left, const WeightedNeighbor& right) {
        const auto left_weight = recent_engager_weight(left);
        const auto right_weight = recent_engager_weight(right);
        if (std::abs(left_weight - right_weight) > 1e-9) {
          return left_weight > right_weight;
        }
        return left.user_id < right.user_id;
      });
  trim_sorted(filtered, limit);

  std::vector<contracts::NeighborCandidate> result;
  result.reserve(filtered.size());
  for (const auto& neighbor : filtered) {
    result.push_back(contracts::NeighborCandidate{
        .user_id = neighbor.user_id,
        .score = recent_engager_weight(neighbor),
        .interaction_probability = neighbor.interaction_probability,
        .engagement_score = positive_engagement(neighbor.rollup_signal_counts),
        .recentness_score = recentness_signal(neighbor.last_interaction_at_ms),
        .relation_kinds = relation_kinds(neighbor),
    });
  }
  return result;
}

std::vector<contracts::MultiHopCandidate> GraphStore::multi_hop_candidates(
    const std::string& user_id,
    const std::size_t limit,
    const std::size_t max_depth,
    const std::size_t max_branching_factor,
    const std::unordered_set<std::string>& excluded_user_ids,
    const bool exclude_direct_neighbors) const {
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
        .accumulated_score = normalized_weight(neighbor),
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
      const auto path_score = node.accumulated_score * normalized_weight(candidate);

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

std::vector<contracts::BridgeCandidate> GraphStore::bridge_users(
    const std::string& user_id,
    const std::size_t limit,
    const std::size_t max_depth,
    const std::size_t max_branching_factor,
    const std::unordered_set<std::string>& excluded_user_ids,
    const bool exclude_direct_neighbors) const {
  auto candidates = multi_hop_candidates(
      user_id,
      std::max(limit * 3, limit),
      max_depth,
      max_branching_factor,
      excluded_user_ids,
      exclude_direct_neighbors);

  std::vector<contracts::BridgeCandidate> result;
  result.reserve(candidates.size());
  for (const auto& candidate : candidates) {
    result.push_back(contracts::BridgeCandidate{
        .user_id = candidate.user_id,
        .score = candidate.score,
        .depth = candidate.depth,
        .path_count = candidate.path_count,
        .via_user_ids = candidate.via_user_ids,
        .bridge_strength = bridge_strength(candidate),
        .via_user_count = candidate.via_user_ids.size(),
    });
  }

  std::sort(
      result.begin(),
      result.end(),
      [](const contracts::BridgeCandidate& left, const contracts::BridgeCandidate& right) {
        if (std::abs(left.bridge_strength - right.bridge_strength) > 1e-9) {
          return left.bridge_strength > right.bridge_strength;
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
    const std::size_t limit) const {
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
