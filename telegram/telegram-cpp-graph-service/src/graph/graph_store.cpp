#include "graph/graph_store.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <numeric>
#include <queue>

#include "graph/ranking.h"

namespace telegram::graph::core {
namespace {

using WeightedNeighbor = GraphStore::WeightedNeighbor;
template <typename T>
using QueryCandidates = GraphStore::QueryCandidates<T>;

double clamp_non_negative(const double value) {
  return std::max(0.0, value);
}

double positive_engagement(const contracts::EdgeSignalCounts& counts) {
  return counts.follow_count * 4.0 + counts.reply_count * 3.0 + counts.mention_count * 2.5 +
         counts.like_count * 1.0 + counts.retweet_count * 1.5 + counts.quote_count * 1.8 +
         counts.profile_view_count * 0.2 + counts.tweet_click_count * 0.1 + counts.address_book_count * 2.0 +
         counts.direct_message_count * 2.6 + counts.co_engagement_count * 2.4 +
         counts.content_affinity_count * 1.7 + counts.dwell_time_ms * 0.0005;
}

double negative_penalty(const contracts::EdgeSignalCounts& counts) {
  return counts.mute_count * 4.0 + counts.block_count * 8.0 + counts.report_count * 6.0;
}

double follow_bonus(const contracts::EdgeSignalCounts& counts) {
  return (counts.follow_count > 0 ? 2.0 : 0.0) + (counts.address_book_count > 0 ? 0.8 : 0.0);
}

double co_engagement_signal(const contracts::EdgeSignalCounts& counts) {
  return counts.co_engagement_count * 3.2 + counts.reply_count * 1.0 + counts.like_count * 0.5 +
         counts.retweet_count * 0.8 + counts.quote_count * 0.9 + counts.mention_count * 0.6;
}

double content_affinity_signal(const contracts::EdgeSignalCounts& counts) {
  return counts.content_affinity_count * 2.8 + counts.profile_view_count * 0.45 +
         counts.tweet_click_count * 0.35 + counts.dwell_time_ms * 0.0011;
}

double direct_message_signal(const contracts::EdgeSignalCounts& counts) {
  return counts.direct_message_count * 2.0 + counts.address_book_count * 0.9;
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
                              neighbor.rollup_signal_counts.mention_count * 0.5 +
                              direct_message_signal(neighbor.rollup_signal_counts) * 0.2;
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
      neighbor.daily_signal_counts.direct_message_count * 1.6 +
      neighbor.daily_signal_counts.co_engagement_count * 1.4 + neighbor.daily_signal_counts.dwell_time_ms * 0.0008;
  const auto rollup_engagement = positive_engagement(neighbor.rollup_signal_counts);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      recency * 2.0 + std::min(2.0, daily_engagement / 5.0) + std::min(2.0, rollup_engagement / 15.0) +
          neighbor.score * 0.25 + neighbor.interaction_probability * 0.15 - penalty);
}

std::vector<std::string> relation_kinds(const WeightedNeighbor& neighbor) {
  std::vector<std::string> kinds = neighbor.edge_kinds;
  if (neighbor.rollup_signal_counts.follow_count > 0) {
    kinds.emplace_back("follow");
  }
  if (neighbor.rollup_signal_counts.address_book_count > 0 ||
      neighbor.rollup_signal_counts.direct_message_count > 0) {
    kinds.emplace_back("chat_dm");
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
      neighbor.daily_signal_counts.mention_count > 0 || neighbor.daily_signal_counts.direct_message_count > 0 ||
      neighbor.daily_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("recent_activity");
  }
  if (neighbor.rollup_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("co_engagement");
  }
  if (neighbor.rollup_signal_counts.content_affinity_count > 0) {
    kinds.emplace_back("content_affinity");
  }

  std::sort(kinds.begin(), kinds.end());
  kinds.erase(std::unique(kinds.begin(), kinds.end()), kinds.end());
  return kinds;
}

double co_engager_weight(const WeightedNeighbor& neighbor) {
  const auto co_signal = co_engagement_signal(neighbor.rollup_signal_counts) +
      co_engagement_signal(neighbor.daily_signal_counts) * 0.55;
  const auto recency = recentness_signal(neighbor.last_interaction_at_ms);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.18;
  return std::max(
      0.0,
      neighbor.score * 0.35 + neighbor.interaction_probability * 0.15 + std::min(4.0, co_signal / 5.0) +
          recency * 0.7 - penalty);
}

double content_affinity_weight(const WeightedNeighbor& neighbor) {
  const auto affinity_signal = content_affinity_signal(neighbor.rollup_signal_counts) +
      content_affinity_signal(neighbor.daily_signal_counts) * 0.45;
  const auto recency = recentness_signal(neighbor.last_interaction_at_ms);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      neighbor.score * 0.3 + neighbor.interaction_probability * 0.1 + std::min(4.0, affinity_signal / 4.0) +
          direct_message_signal(neighbor.rollup_signal_counts) * 0.1 + recency * 0.4 - penalty);
}

std::vector<std::string> edge_kinds_from_record(const contracts::SnapshotEdgeRecord& edge) {
  std::vector<std::string> kinds = edge.edge_kinds;
  if (edge.rollup_signal_counts.follow_count > 0) {
    kinds.emplace_back("follow");
  }
  if (edge.rollup_signal_counts.address_book_count > 0 || edge.rollup_signal_counts.direct_message_count > 0) {
    kinds.emplace_back("chat_dm");
  }
  if (edge.rollup_signal_counts.reply_count > 0 || edge.rollup_signal_counts.mention_count > 0) {
    kinds.emplace_back("reply_mention");
  }
  if (edge.rollup_signal_counts.retweet_count > 0 || edge.rollup_signal_counts.quote_count > 0) {
    kinds.emplace_back("repost");
  }
  if (edge.rollup_signal_counts.like_count > 0) {
    kinds.emplace_back("like");
  }
  if (edge.daily_signal_counts.like_count > 0 || edge.daily_signal_counts.reply_count > 0 ||
      edge.daily_signal_counts.retweet_count > 0 || edge.daily_signal_counts.quote_count > 0 ||
      edge.daily_signal_counts.mention_count > 0 || edge.daily_signal_counts.direct_message_count > 0 ||
      edge.daily_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("recent_engagement");
  }
  if (edge.rollup_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("co_engagement");
  }
  if (edge.rollup_signal_counts.content_affinity_count > 0 || edge.rollup_signal_counts.profile_view_count > 0 ||
      edge.rollup_signal_counts.tweet_click_count > 0 || edge.rollup_signal_counts.dwell_time_ms > 0) {
    kinds.emplace_back("content_affinity");
  }

  std::sort(kinds.begin(), kinds.end());
  kinds.erase(std::unique(kinds.begin(), kinds.end()), kinds.end());
  return kinds;
}

template <typename T>
void trim_sorted(std::vector<T>& values, const std::size_t limit);

template <typename WeightFn>
QueryCandidates<contracts::NeighborCandidate> rank_neighbors(
    const std::vector<WeightedNeighbor>& neighbors,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids,
    WeightFn weight_fn) {
  std::vector<double> weights(neighbors.size());
  std::vector<std::size_t> indices;
  indices.reserve(neighbors.size());

  for (std::size_t i = 0; i < neighbors.size(); ++i) {
    if (excluded_user_ids.contains(neighbors[i].user_id)) {
      continue;
    }
    weights[i] = weight_fn(neighbors[i]);
    indices.push_back(i);
  }

  const auto available_count = indices.size();
  const auto trim_count = std::min(available_count, limit);
  ranking::sort_top_k(
      indices.begin(),
      indices.end(),
      trim_count,
      [&](const std::size_t left, const std::size_t right) {
        if (std::abs(weights[left] - weights[right]) > 1e-9) {
          return weights[left] > weights[right];
        }
        return neighbors[left].user_id < neighbors[right].user_id;
      });

  std::vector<contracts::NeighborCandidate> result;
  result.reserve(trim_count);
  for (std::size_t i = 0; i < trim_count; ++i) {
    const auto& neighbor = neighbors[indices[i]];
    result.push_back(contracts::NeighborCandidate{
        .user_id = neighbor.user_id,
        .score = weights[indices[i]],
        .interaction_probability = neighbor.interaction_probability,
        .engagement_score = positive_engagement(neighbor.rollup_signal_counts),
        .recentness_score = recentness_signal(neighbor.last_interaction_at_ms),
        .relation_kinds = relation_kinds(neighbor),
    });
  }
  return QueryCandidates<contracts::NeighborCandidate>{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = neighbors.size(),
  };
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

contracts::EdgeSignalCounts add_counts(
    contracts::EdgeSignalCounts left,
    const contracts::EdgeSignalCounts& right) {
  left.follow_count += right.follow_count;
  left.like_count += right.like_count;
  left.reply_count += right.reply_count;
  left.retweet_count += right.retweet_count;
  left.quote_count += right.quote_count;
  left.mention_count += right.mention_count;
  left.profile_view_count += right.profile_view_count;
  left.tweet_click_count += right.tweet_click_count;
  left.dwell_time_ms += right.dwell_time_ms;
  left.address_book_count += right.address_book_count;
  left.direct_message_count += right.direct_message_count;
  left.co_engagement_count += right.co_engagement_count;
  left.content_affinity_count += right.content_affinity_count;
  left.mute_count += right.mute_count;
  left.block_count += right.block_count;
  left.report_count += right.report_count;
  return left;
}

std::optional<std::int64_t> max_optional(
    const std::optional<std::int64_t>& left,
    const std::optional<std::int64_t>& right) {
  if (!left.has_value()) return right;
  if (!right.has_value()) return left;
  return std::max(left.value(), right.value());
}

void merge_edge_kinds(std::vector<std::string>& target, const std::vector<std::string>& source) {
  target.insert(target.end(), source.begin(), source.end());
  std::sort(target.begin(), target.end());
  target.erase(std::unique(target.begin(), target.end()), target.end());
}

}  // namespace

GraphStore::MultiHopBuildResult GraphStore::build_multi_hop_candidates(
    const SnapshotData& snapshot,
    const std::string& user_id,
    const std::size_t max_depth,
    const std::size_t max_branching_factor,
    const std::size_t max_visited_nodes,
    const std::size_t max_candidates,
    const std::unordered_set<std::string>& excluded_user_ids,
    const bool exclude_direct_neighbors) const {
  const auto& direct_neighbors = read_neighbors(snapshot, user_id);
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
  std::size_t visited_count = 0;
  bool budget_exhausted = false;
  while (!frontier.empty()) {
    const auto node = frontier.front();
    frontier.pop();
    visited_count += 1;
    if (max_visited_nodes > 0 && visited_count > max_visited_nodes) {
      budget_exhausted = true;
      break;
    }

    if (node.depth >= max_depth) {
      continue;
    }

    const auto& next_neighbors = read_neighbors(snapshot, node.current_user_id);
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

      const auto existing_entry = aggregate.find(candidate.user_id);
      if (existing_entry == aggregate.end() && max_candidates > 0 && aggregate.size() >= max_candidates) {
        budget_exhausted = true;
        continue;
      }
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
  for (auto& [candidate_user_id, aggregate_candidate] : aggregate) {
    std::vector<std::string> via_user_ids(
        aggregate_candidate.via_user_ids.begin(),
        aggregate_candidate.via_user_ids.end());
    std::sort(via_user_ids.begin(), via_user_ids.end());
    result.push_back(contracts::MultiHopCandidate{
        .user_id = candidate_user_id,
        .score = aggregate_candidate.score,
        .depth = aggregate_candidate.depth,
        .path_count = aggregate_candidate.path_count,
        .via_user_ids = via_user_ids,
    });
  }
  return MultiHopBuildResult{
      .candidates = std::move(result),
      .visited_count = visited_count,
      .budget_exhausted = budget_exhausted,
  };
}

void GraphStore::replace_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at) {
  auto next_snapshot = std::make_shared<SnapshotData>();
  auto& next_adjacency = next_snapshot->adjacency;
  std::unordered_map<std::string, std::unordered_map<std::string, WeightedNeighbor>> grouped_adjacency;
  std::unordered_map<std::string, std::size_t> edge_kind_counts;
  std::unordered_set<std::string> vertices;
  vertices.reserve(edges.size() * 2);
  grouped_adjacency.reserve(edges.size());

  for (const auto& edge : edges) {
    vertices.insert(edge.source_user_id);
    vertices.insert(edge.target_user_id);
    const auto edge_kinds = edge_kinds_from_record(edge);
    for (const auto& kind : edge_kinds) {
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

  next_adjacency.reserve(grouped_adjacency.size());
  for (auto& [source_user_id, target_map] : grouped_adjacency) {
    auto& neighbors = next_adjacency[source_user_id];
    neighbors.reserve(target_map.size());
    for (auto& [target_user_id, neighbor] : target_map) {
      (void)target_user_id;
      neighbors.push_back(std::move(neighbor));
    }
  }

  for (auto& [user_id, neighbors] : next_adjacency) {
    std::vector<double> weights(neighbors.size());
    for (std::size_t i = 0; i < neighbors.size(); ++i) {
      weights[i] = normalized_weight(neighbors[i]);
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
      const auto idx = indices[i];
      sorted.push_back(std::move(neighbors[idx]));
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

  const auto memory_estimate_bytes = [&next_snapshot, &edge_kind_counts]() {
    std::size_t total = sizeof(SnapshotData);
    for (const auto& [user_id, neighbors] : next_snapshot->adjacency) {
      total += user_id.capacity();
      total += neighbors.capacity() * sizeof(WeightedNeighbor);
      for (const auto& neighbor : neighbors) {
        total += neighbor.user_id.capacity();
        total += neighbor.edge_kinds.capacity() * sizeof(std::string);
        for (const auto& kind : neighbor.edge_kinds) {
          total += kind.capacity();
        }
      }
    }
    for (const auto& [user_id, index] : next_snapshot->neighbors_by_user_id) {
      total += user_id.capacity();
      total += index.capacity() * sizeof(const WeightedNeighbor*);
    }
    for (const auto& [kind, count] : edge_kind_counts) {
      (void)count;
      total += kind.capacity() + sizeof(std::size_t);
    }
    return total;
  }();

  next_snapshot->metadata = SnapshotMetadata{
      .loaded = true,
      .edge_count = edges.size(),
      .vertex_count = vertices.size(),
      .memory_estimate_bytes = memory_estimate_bytes,
      .snapshot_version = snapshot_version,
      .edge_kind_counts = std::move(edge_kind_counts),
      .loaded_at = loaded_at,
  };
  std::atomic_store_explicit(&snapshot_, std::shared_ptr<const SnapshotData>(std::move(next_snapshot)), std::memory_order_release);
}

std::shared_ptr<const GraphStore::SnapshotData> GraphStore::read_snapshot() const {
  return std::atomic_load_explicit(&snapshot_, std::memory_order_acquire);
}

const std::vector<GraphStore::WeightedNeighbor>& GraphStore::read_neighbors(
    const SnapshotData& snapshot,
    const std::string& user_id) {
  static const auto kEmpty = std::vector<WeightedNeighbor>{};
  const auto iterator = snapshot.adjacency.find(user_id);
  if (iterator == snapshot.adjacency.end()) {
    return kEmpty;
  }
  return iterator->second;
}

const std::vector<const GraphStore::WeightedNeighbor*>& GraphStore::read_neighbor_index(
    const SnapshotData& snapshot,
    const std::string& user_id) {
  static const auto kEmpty = std::vector<const WeightedNeighbor*>{};
  const auto iterator = snapshot.neighbors_by_user_id.find(user_id);
  if (iterator == snapshot.neighbors_by_user_id.end()) {
    return kEmpty;
  }
  return iterator->second;
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::direct_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  std::vector<contracts::NeighborCandidate> result;
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto& neighbors = read_neighbors(*snapshot, user_id);
  std::size_t available_count = 0;
  for (const auto& neighbor : neighbors) {
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    available_count += 1;
    if (result.size() < limit) {
      result.push_back(contracts::NeighborCandidate{
          .user_id = neighbor.user_id,
          .score = neighbor.score,
          .interaction_probability = neighbor.interaction_probability,
          .engagement_score = positive_engagement(neighbor.rollup_signal_counts),
          .recentness_score = recentness_signal(neighbor.last_interaction_at_ms),
          .relation_kinds = relation_kinds(neighbor),
      });
    }
  }
  return QueryCandidates<contracts::NeighborCandidate>{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = neighbors.size(),
  };
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::social_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_neighbors(read_neighbors(*snapshot, user_id), limit, excluded_user_ids, social_weight);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::recent_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_neighbors(read_neighbors(*snapshot, user_id), limit, excluded_user_ids, recent_engager_weight);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::co_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_neighbors(read_neighbors(*snapshot, user_id), limit, excluded_user_ids, co_engager_weight);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::content_affinity_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_neighbors(read_neighbors(*snapshot, user_id), limit, excluded_user_ids, content_affinity_weight);
}

QueryCandidates<contracts::MultiHopCandidate> GraphStore::multi_hop_candidates(
    const std::string& user_id,
    const std::size_t limit,
    const std::size_t max_depth,
    const std::size_t max_branching_factor,
    const std::size_t max_visited_nodes,
    const std::size_t max_candidates,
    const std::unordered_set<std::string>& excluded_user_ids,
    const bool exclude_direct_neighbors) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::MultiHopCandidate>{};
  }
  auto build_result = build_multi_hop_candidates(
      *snapshot,
      user_id,
      max_depth,
      max_branching_factor,
      max_visited_nodes,
      max_candidates,
      excluded_user_ids,
      exclude_direct_neighbors);
  auto result = std::move(build_result.candidates);
  const auto available_count = result.size();
  ranking::sort_top_k(
      result.begin(),
      result.end(),
      limit,
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
  return QueryCandidates<contracts::MultiHopCandidate>{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = build_result.visited_count,
      .visited_count = build_result.visited_count,
      .budget_exhausted = build_result.budget_exhausted,
  };
}

QueryCandidates<contracts::BridgeCandidate> GraphStore::bridge_users(
    const std::string& user_id,
    const std::size_t limit,
    const std::size_t max_depth,
    const std::size_t max_branching_factor,
    const std::size_t max_visited_nodes,
    const std::size_t max_candidates,
    const std::unordered_set<std::string>& excluded_user_ids,
    const bool exclude_direct_neighbors) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::BridgeCandidate>{};
  }
  auto build_result = build_multi_hop_candidates(
      *snapshot,
      user_id,
      max_depth,
      max_branching_factor,
      max_visited_nodes,
      max_candidates,
      excluded_user_ids,
      exclude_direct_neighbors);
  auto candidates = std::move(build_result.candidates);

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

  const auto available_count = result.size();
  ranking::sort_top_k(
      result.begin(),
      result.end(),
      limit,
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
  return QueryCandidates<contracts::BridgeCandidate>{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = build_result.visited_count,
      .visited_count = build_result.visited_count,
      .budget_exhausted = build_result.budget_exhausted,
  };
}

QueryCandidates<contracts::OverlapCandidate> GraphStore::overlap_candidates(
    const std::string& user_a_id,
    const std::string& user_b_id,
    const std::size_t limit) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::OverlapCandidate>{};
  }
  const auto& neighbors_a = read_neighbor_index(*snapshot, user_a_id);
  const auto& neighbors_b = read_neighbor_index(*snapshot, user_b_id);
  if (neighbors_a.empty() || neighbors_b.empty()) {
    return QueryCandidates<contracts::OverlapCandidate>{};
  }

  std::vector<contracts::OverlapCandidate> result;
  std::size_t index_a = 0;
  std::size_t index_b = 0;
  while (index_a < neighbors_a.size() && index_b < neighbors_b.size()) {
    const auto* neighbor_a = neighbors_a[index_a];
    const auto* neighbor_b = neighbors_b[index_b];
    if (neighbor_a->user_id < neighbor_b->user_id) {
      index_a += 1;
      continue;
    }
    if (neighbor_b->user_id < neighbor_a->user_id) {
      index_b += 1;
      continue;
    }
    result.push_back(contracts::OverlapCandidate{
        .user_id = neighbor_a->user_id,
        .combined_score = neighbor_a->score + neighbor_b->score,
        .user_a_score = neighbor_a->score,
        .user_b_score = neighbor_b->score,
    });
    index_a += 1;
    index_b += 1;
  }

  const auto available_count = result.size();
  ranking::sort_top_k(
      result.begin(),
      result.end(),
      limit,
      [](const contracts::OverlapCandidate& left, const contracts::OverlapCandidate& right) {
        if (std::abs(left.combined_score - right.combined_score) > 1e-9) {
          return left.combined_score > right.combined_score;
        }
        return left.user_id < right.user_id;
      });
  trim_sorted(result, limit);
  return QueryCandidates<contracts::OverlapCandidate>{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = neighbors_a.size() + neighbors_b.size(),
  };
}

SnapshotMetadata GraphStore::metadata() const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return SnapshotMetadata{};
  }
  return snapshot->metadata;
}

}  // namespace telegram::graph::core
