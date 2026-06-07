#include "graph/graph_store.h"

#include <memory>

#include "graph/query/neighbors/direct_query.h"
#include "graph/query/neighbors/ranked_query.h"
#include "graph/query/overlap/overlap_query.h"
#include "graph/query/scoring.h"
#include "graph/query/traversal/bridge_query.h"
#include "graph/query/traversal/multi_hop_query.h"
#include "graph/snapshot/snapshot_builder.h"
#include "graph/store/dense_index_reader.h"

namespace telegram::graph::core {
namespace {

using WeightedNeighbor = GraphStore::WeightedNeighbor;
template <typename T>
using QueryCandidates = GraphStore::QueryCandidates<T>;

bool should_stream_overlap_topk(
    const bool enabled,
    const std::size_t limit,
    const std::size_t left_size,
    const std::size_t right_size) {
  if (!enabled || limit == 0) {
    return false;
  }
  const auto upper_bound = std::min(left_size, right_size);
  return upper_bound > 0 && limit * 4 < upper_bound;
}

std::int64_t request_now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}  // namespace

void GraphStore::replace_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at) {
  auto next_snapshot = snapshot::build_snapshot<SnapshotData, WeightedNeighbor>(
      edges,
      max_neighbors_per_user,
      snapshot_version,
      loaded_at,
      query::normalized_weight);
  snapshot_.publish(std::move(next_snapshot));
}

void GraphStore::publish_snapshot(std::shared_ptr<const store::SnapshotData> snapshot) {
  snapshot_.publish(std::move(snapshot));
}

void GraphStore::set_traversal_best_first_enabled(const bool enabled) {
  traversal_best_first_enabled_ = enabled;
}

void GraphStore::set_overlap_streaming_topk_enabled(const bool enabled) {
  overlap_streaming_topk_enabled_ = enabled;
}

std::shared_ptr<const GraphStore::SnapshotData> GraphStore::read_snapshot() const {
  return snapshot_.read();
}

std::unordered_set<std::uint32_t> GraphStore::intern_excluded_ids(
    const SnapshotData& snapshot,
    const std::unordered_set<std::string>& excluded_user_ids) {
  std::unordered_set<std::uint32_t> result;
  result.reserve(excluded_user_ids.size());
  for (const auto& id : excluded_user_ids) {
    if (auto interned = snapshot.user_ids.find(id); interned.has_value()) {
      result.insert(interned.value());
    }
  }
  return result;
}

template <typename WeightFn>
QueryCandidates<contracts::NeighborCandidate> GraphStore::rank_dense_neighbors(
    const std::span<const SnapshotData::DenseNeighborRef> neighbors,
    const std::size_t limit,
    const std::unordered_set<std::uint32_t>& excluded_interned_ids,
    WeightFn weight_fn) {
  return query::rank_neighbors<QueryCandidates<contracts::NeighborCandidate>>(
      neighbors,
      limit,
      excluded_interned_ids,
      weight_fn);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::direct_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto neighbors = store::read_ranked_dense_neighbor_index(*snapshot, user_id);
  return query::direct_neighbors<QueryCandidates<contracts::NeighborCandidate>>(
      neighbors,
      limit,
      intern_excluded_ids(*snapshot, excluded_user_ids));
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::social_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      intern_excluded_ids(*snapshot, excluded_user_ids),
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::social_weight_at(neighbor, now_ms);
      });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::recent_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      intern_excluded_ids(*snapshot, excluded_user_ids),
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::recent_engager_weight_at(neighbor, now_ms);
      });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::co_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      intern_excluded_ids(*snapshot, excluded_user_ids),
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::co_engager_weight_at(neighbor, now_ms);
      });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::content_affinity_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      intern_excluded_ids(*snapshot, excluded_user_ids),
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::content_affinity_weight_at(neighbor, now_ms);
      });
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
  const auto source_id = snapshot->user_ids.find(user_id);
  if (!source_id.has_value()) {
    return QueryCandidates<contracts::MultiHopCandidate>{};
  }
  const auto now_ms = request_now_ms();
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(*snapshot, source_id.value()),
      intern_excluded_ids(*snapshot, excluded_user_ids),
      query::TraversalOptions{
          .max_depth = max_depth,
          .max_branching_factor = max_branching_factor,
          .max_visited_nodes = max_visited_nodes,
          .max_candidates = max_candidates,
          .exclude_direct_neighbors = exclude_direct_neighbors,
          .best_first = traversal_best_first_enabled_,
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return snapshot->user_ids.value(id);
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return store::read_ranked_dense_neighbor_index_by_id(*snapshot, id);
      },
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::normalized_weight_at(neighbor, now_ms);
      });
  return query::rank_multi_hop_candidates<QueryCandidates<contracts::MultiHopCandidate>>(
      std::move(build_result.candidates),
      limit,
      build_result.visited_count,
      build_result.budget_exhausted);
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
  const auto source_id = snapshot->user_ids.find(user_id);
  if (!source_id.has_value()) {
    return QueryCandidates<contracts::BridgeCandidate>{};
  }
  const auto now_ms = request_now_ms();
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(*snapshot, source_id.value()),
      intern_excluded_ids(*snapshot, excluded_user_ids),
      query::TraversalOptions{
          .max_depth = max_depth,
          .max_branching_factor = max_branching_factor,
          .max_visited_nodes = max_visited_nodes,
          .max_candidates = max_candidates,
          .exclude_direct_neighbors = exclude_direct_neighbors,
          .best_first = traversal_best_first_enabled_,
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return snapshot->user_ids.value(id);
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return store::read_ranked_dense_neighbor_index_by_id(*snapshot, id);
      },
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::normalized_weight_at(neighbor, now_ms);
      });
  return query::bridge_candidates_from_multi_hop<QueryCandidates<contracts::BridgeCandidate>>(
      build_result.candidates,
      limit,
      build_result.visited_count,
      build_result.budget_exhausted);
}

QueryCandidates<contracts::OverlapCandidate> GraphStore::overlap_candidates(
    const std::string& user_a_id,
    const std::string& user_b_id,
    const std::size_t limit) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::OverlapCandidate>{};
  }
  const auto neighbors_a = store::read_dense_neighbor_index(*snapshot, user_a_id);
  const auto neighbors_b = store::read_dense_neighbor_index(*snapshot, user_b_id);
  if (should_stream_overlap_topk(overlap_streaming_topk_enabled_, limit, neighbors_a.size(), neighbors_b.size())) {
    return query::overlap_candidates<QueryCandidates<contracts::OverlapCandidate>>(
        neighbors_a,
        neighbors_b,
        limit);
  }
  return query::overlap_candidates_materialized<QueryCandidates<contracts::OverlapCandidate>>(
      neighbors_a,
      neighbors_b,
      limit);
}

SnapshotMetadata GraphStore::metadata() const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return SnapshotMetadata{};
  }
  return snapshot->metadata;
}

}  // namespace telegram::graph::core
