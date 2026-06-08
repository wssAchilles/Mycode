#include "graph/graph_store.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>

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

void validate_snapshot_edges(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user) {
  if (edges.empty()) {
    throw std::invalid_argument("snapshot edges must not be empty");
  }
  if (max_neighbors_per_user == 0) {
    throw std::invalid_argument("max_neighbors_per_user must be greater than 0");
  }
  const auto has_invalid_weight = std::any_of(edges.begin(), edges.end(), [](const auto& edge) {
    return !std::isfinite(edge.decayed_sum) || edge.decayed_sum < 0.0;
  });
  if (has_invalid_weight) {
    throw std::invalid_argument("SnapshotEdgeRecord.decayedSum must be finite and non-negative");
  }
}

void validate_publishable_snapshot(
    const std::shared_ptr<const store::SnapshotData>& snapshot,
    const std::shared_ptr<const store::SnapshotData>& current_snapshot) {
  if (snapshot == nullptr) {
    throw std::invalid_argument("snapshot must not be null");
  }
  if (snapshot->metadata.edge_count == 0) {
    throw std::invalid_argument("snapshot edges must not be empty");
  }
  if (snapshot->metadata.max_neighbors_per_user == 0) {
    throw std::invalid_argument("max_neighbors_per_user must be greater than 0");
  }
  if (current_snapshot != nullptr && current_snapshot->metadata.loaded &&
      !snapshot->metadata.snapshot_version.empty() &&
      !current_snapshot->metadata.snapshot_version.empty() &&
      snapshot->metadata.snapshot_version < current_snapshot->metadata.snapshot_version) {
    throw std::invalid_argument("snapshot version must not regress");
  }
  const auto has_invalid_weight = std::any_of(
      snapshot->adjacency.begin(),
      snapshot->adjacency.end(),
      [](const auto& entry) {
        const auto& neighbors = entry.second;
        return std::any_of(neighbors.begin(), neighbors.end(), [](const auto& neighbor) {
          return !std::isfinite(neighbor.score) || neighbor.score < 0.0;
        });
      });
  if (has_invalid_weight) {
    throw std::invalid_argument("SnapshotEdgeRecord.decayedSum must be finite and non-negative");
  }
}

template <typename Candidate>
QueryCandidates<Candidate> with_snapshot_diagnostics(
    QueryCandidates<Candidate> result,
    const store::SnapshotData& snapshot) {
  result.snapshot_version = snapshot.metadata.snapshot_version;
  result.snapshot_loaded_at = snapshot.metadata.loaded_at;
  return result;
}

}  // namespace

void GraphStore::replace_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at) {
  validate_snapshot_edges(edges, max_neighbors_per_user);
  auto next_snapshot = snapshot::build_snapshot<SnapshotData, WeightedNeighbor>(
      edges,
      max_neighbors_per_user,
      snapshot_version,
      loaded_at,
      query::normalized_weight);
  publish_snapshot(std::move(next_snapshot));
}

void GraphStore::publish_snapshot(std::shared_ptr<const store::SnapshotData> snapshot) {
  validate_publishable_snapshot(snapshot, read_snapshot());
  snapshot_.publish(std::move(snapshot));
}

bool GraphStore::rollback_snapshot() {
  return snapshot_.rollback();
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
    const NeighborQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto neighbors = store::read_ranked_dense_neighbor_index(*snapshot, query.user_id);
  return with_snapshot_diagnostics(
      query::direct_neighbors<QueryCandidates<contracts::NeighborCandidate>>(
          neighbors,
          query.limit,
          intern_excluded_ids(*snapshot, query.excluded_user_ids)),
      *snapshot);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::direct_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  return direct_neighbors(NeighborQuery{
      .user_id = user_id,
      .limit = limit,
      .excluded_user_ids = excluded_user_ids,
  });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::social_neighbors(
    const NeighborQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(*snapshot, query.user_id),
          query.limit,
          intern_excluded_ids(*snapshot, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::social_weight_at(neighbor, now_ms);
          }),
      *snapshot);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::social_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  return social_neighbors(NeighborQuery{
      .user_id = user_id,
      .limit = limit,
      .excluded_user_ids = excluded_user_ids,
  });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::recent_engagers(
    const NeighborQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(*snapshot, query.user_id),
          query.limit,
          intern_excluded_ids(*snapshot, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::recent_engager_weight_at(neighbor, now_ms);
          }),
      *snapshot);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::recent_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  return recent_engagers(NeighborQuery{
      .user_id = user_id,
      .limit = limit,
      .excluded_user_ids = excluded_user_ids,
  });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::co_engagers(
    const NeighborQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(*snapshot, query.user_id),
          query.limit,
          intern_excluded_ids(*snapshot, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::co_engager_weight_at(neighbor, now_ms);
          }),
      *snapshot);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::co_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  return co_engagers(NeighborQuery{
      .user_id = user_id,
      .limit = limit,
      .excluded_user_ids = excluded_user_ids,
  });
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::content_affinity_neighbors(
    const NeighborQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto now_ms = request_now_ms();
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(*snapshot, query.user_id),
          query.limit,
          intern_excluded_ids(*snapshot, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::content_affinity_weight_at(neighbor, now_ms);
          }),
      *snapshot);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::content_affinity_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  return content_affinity_neighbors(NeighborQuery{
      .user_id = user_id,
      .limit = limit,
      .excluded_user_ids = excluded_user_ids,
  });
}

QueryCandidates<contracts::MultiHopCandidate> GraphStore::multi_hop_candidates(
    const TraversalQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::MultiHopCandidate>{};
  }
  const auto source_id = snapshot->user_ids.find(query.user_id);
  if (!source_id.has_value()) {
    return with_snapshot_diagnostics(QueryCandidates<contracts::MultiHopCandidate>{}, *snapshot);
  }
  const auto now_ms = request_now_ms();
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(*snapshot, source_id.value()),
      intern_excluded_ids(*snapshot, query.excluded_user_ids),
      query::TraversalOptions{
          .max_depth = query.max_depth,
          .max_branching_factor = query.max_branching_factor,
          .max_visited_nodes = query.max_visited_nodes,
          .max_candidates = query.max_candidates,
          .exclude_direct_neighbors = query.exclude_direct_neighbors,
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
  auto result = query::rank_multi_hop_candidates<QueryCandidates<contracts::MultiHopCandidate>>(
      std::move(build_result.candidates),
      query.limit,
      build_result.visited_count,
      build_result.budget_exhausted);
  result.pruned_count = build_result.pruned_count;
  result.frontier_max_size = build_result.frontier_max_size;
  return with_snapshot_diagnostics(std::move(result), *snapshot);
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
  return multi_hop_candidates(TraversalQuery{
      .user_id = user_id,
      .limit = limit,
      .max_depth = max_depth,
      .max_branching_factor = max_branching_factor,
      .max_visited_nodes = max_visited_nodes,
      .max_candidates = max_candidates,
      .excluded_user_ids = excluded_user_ids,
      .exclude_direct_neighbors = exclude_direct_neighbors,
  });
}

QueryCandidates<contracts::BridgeCandidate> GraphStore::bridge_users(
    const TraversalQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::BridgeCandidate>{};
  }
  const auto source_id = snapshot->user_ids.find(query.user_id);
  if (!source_id.has_value()) {
    return with_snapshot_diagnostics(QueryCandidates<contracts::BridgeCandidate>{}, *snapshot);
  }
  const auto now_ms = request_now_ms();
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(*snapshot, source_id.value()),
      intern_excluded_ids(*snapshot, query.excluded_user_ids),
      query::TraversalOptions{
          .max_depth = query.max_depth,
          .max_branching_factor = query.max_branching_factor,
          .max_visited_nodes = query.max_visited_nodes,
          .max_candidates = query.max_candidates,
          .exclude_direct_neighbors = query.exclude_direct_neighbors,
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
  auto result = query::bridge_candidates_from_multi_hop<QueryCandidates<contracts::BridgeCandidate>>(
      build_result.candidates,
      query.limit,
      build_result.visited_count,
      build_result.budget_exhausted);
  result.pruned_count = build_result.pruned_count;
  result.frontier_max_size = build_result.frontier_max_size;
  return with_snapshot_diagnostics(std::move(result), *snapshot);
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
  return bridge_users(TraversalQuery{
      .user_id = user_id,
      .limit = limit,
      .max_depth = max_depth,
      .max_branching_factor = max_branching_factor,
      .max_visited_nodes = max_visited_nodes,
      .max_candidates = max_candidates,
      .excluded_user_ids = excluded_user_ids,
      .exclude_direct_neighbors = exclude_direct_neighbors,
  });
}

QueryCandidates<contracts::OverlapCandidate> GraphStore::overlap_candidates(
    const OverlapQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::OverlapCandidate>{};
  }
  const auto neighbors_a = store::read_dense_neighbor_index(*snapshot, query.user_a_id);
  const auto neighbors_b = store::read_dense_neighbor_index(*snapshot, query.user_b_id);
  if (should_stream_overlap_topk(overlap_streaming_topk_enabled_, query.limit, neighbors_a.size(), neighbors_b.size())) {
    return with_snapshot_diagnostics(
        query::overlap_candidates<QueryCandidates<contracts::OverlapCandidate>>(
            neighbors_a,
            neighbors_b,
            query.limit),
        *snapshot);
  }
  return with_snapshot_diagnostics(
      query::overlap_candidates_materialized<QueryCandidates<contracts::OverlapCandidate>>(
          neighbors_a,
          neighbors_b,
          query.limit),
      *snapshot);
}

QueryCandidates<contracts::OverlapCandidate> GraphStore::overlap_candidates(
    const std::string& user_a_id,
    const std::string& user_b_id,
    const std::size_t limit) const {
  return overlap_candidates(OverlapQuery{
      .user_a_id = user_a_id,
      .user_b_id = user_b_id,
      .limit = limit,
  });
}

SnapshotMetadata GraphStore::metadata() const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return SnapshotMetadata{};
  }
  return snapshot->metadata;
}

}  // namespace telegram::graph::core
