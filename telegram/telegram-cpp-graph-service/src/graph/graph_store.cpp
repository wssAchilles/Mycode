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
  std::atomic_store_explicit(
      &snapshot_,
      std::shared_ptr<const SnapshotData>(std::move(next_snapshot)),
      std::memory_order_release);
}

std::shared_ptr<const GraphStore::SnapshotData> GraphStore::read_snapshot() const {
  return std::atomic_load_explicit(&snapshot_, std::memory_order_acquire);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::rank_dense_neighbors(
    const std::span<const SnapshotData::DenseNeighborRef> neighbors,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids,
    const NeighborWeightFn weight_fn) {
  return query::rank_neighbors<QueryCandidates<contracts::NeighborCandidate>>(
      neighbors,
      limit,
      excluded_user_ids,
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
      excluded_user_ids);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::social_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      excluded_user_ids,
      query::social_weight);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::recent_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      excluded_user_ids,
      query::recent_engager_weight);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::co_engagers(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      excluded_user_ids,
      query::co_engager_weight);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::content_affinity_neighbors(
    const std::string& user_id,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  return rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(*snapshot, user_id),
      limit,
      excluded_user_ids,
      query::content_affinity_weight);
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
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(*snapshot, source_id.value()),
      excluded_user_ids,
      query::TraversalOptions{
          .max_depth = max_depth,
          .max_branching_factor = max_branching_factor,
          .max_visited_nodes = max_visited_nodes,
          .max_candidates = max_candidates,
          .exclude_direct_neighbors = exclude_direct_neighbors,
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return snapshot->user_ids.value(id);
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return store::read_ranked_dense_neighbor_index_by_id(*snapshot, id);
      },
      query::normalized_weight);
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
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(*snapshot, source_id.value()),
      excluded_user_ids,
      query::TraversalOptions{
          .max_depth = max_depth,
          .max_branching_factor = max_branching_factor,
          .max_visited_nodes = max_visited_nodes,
          .max_candidates = max_candidates,
          .exclude_direct_neighbors = exclude_direct_neighbors,
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return snapshot->user_ids.value(id);
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return store::read_ranked_dense_neighbor_index_by_id(*snapshot, id);
      },
      query::normalized_weight);
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
  return query::overlap_candidates<QueryCandidates<contracts::OverlapCandidate>>(
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
