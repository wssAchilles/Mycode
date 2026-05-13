#include "graph/graph_store.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <numeric>
#include <queue>

#include "graph/query/budget.h"
#include "graph/query/candidates.h"
#include "graph/query/scoring.h"
#include "graph/ranking.h"
#include "graph/snapshot/csr_index.h"
#include "graph/snapshot/dense_layout.h"
#include "graph/snapshot/edge_aggregation.h"
#include "graph/snapshot/memory_estimator.h"

namespace telegram::graph::core {
namespace {

using WeightedNeighbor = GraphStore::WeightedNeighbor;
template <typename T>
using QueryCandidates = GraphStore::QueryCandidates<T>;

template <typename T>
void trim_sorted(std::vector<T>& values, const std::size_t limit);

template <typename T>
void trim_sorted(std::vector<T>& values, const std::size_t limit) {
  if (values.size() > limit) {
    values.resize(limit);
  }
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
  const auto source_id = snapshot.user_ids.find(user_id);
  if (!source_id.has_value()) {
    return {};
  }

  const auto direct_neighbors = read_ranked_dense_neighbor_index_by_id(snapshot, source_id.value());
  if (direct_neighbors.empty()) {
    return {};
  }

  std::unordered_set<snapshot::StringInterner::Id> direct_neighbor_ids;
  direct_neighbor_ids.reserve(direct_neighbors.size());
  for (const auto& ref : direct_neighbors) {
    direct_neighbor_ids.insert(ref.target_id);
  }

  struct FrontierNode {
    snapshot::StringInterner::Id current_user_id;
    snapshot::StringInterner::Id first_hop_user_id;
    double accumulated_score;
    std::size_t depth;
  };

  struct AggregateCandidate {
    double score{0.0};
    std::size_t depth{0};
    std::size_t path_count{0};
    std::unordered_set<snapshot::StringInterner::Id> via_user_ids;
  };

  std::queue<FrontierNode> frontier;
  for (const auto& ref : direct_neighbors) {
    const auto& neighbor = *ref.neighbor;
    frontier.push(FrontierNode{
        .current_user_id = ref.target_id,
        .first_hop_user_id = ref.target_id,
        .accumulated_score = query::normalized_weight(neighbor),
        .depth = 1,
    });
  }

  std::unordered_map<snapshot::StringInterner::Id, AggregateCandidate> aggregate;
  query::TraversalBudgetTracker budget_tracker(query::TraversalBudget{
      .max_visited_nodes = max_visited_nodes,
      .max_candidates = max_candidates,
  });
  while (!frontier.empty()) {
    const auto node = frontier.front();
    frontier.pop();
    if (!budget_tracker.record_visit()) {
      break;
    }

    if (node.depth >= max_depth) {
      continue;
    }

    const auto next_neighbors = read_ranked_dense_neighbor_index_by_id(snapshot, node.current_user_id);
    const auto branching_limit = std::min(next_neighbors.size(), max_branching_factor);
    for (std::size_t index = 0; index < branching_limit; index += 1) {
      const auto& ref = next_neighbors[index];
      const auto& candidate = *ref.neighbor;
      if (ref.target_id == source_id.value() || excluded_user_ids.contains(candidate.user_id)) {
        continue;
      }
      if (exclude_direct_neighbors && direct_neighbor_ids.contains(ref.target_id)) {
        continue;
      }

      const auto next_depth = node.depth + 1;
      const auto path_score = node.accumulated_score * query::normalized_weight(candidate);

      const auto existing_entry = aggregate.find(ref.target_id);
      if (existing_entry == aggregate.end() && !budget_tracker.can_add_new_candidate(aggregate.size())) {
        continue;
      }
      auto& entry = aggregate[ref.target_id];
      entry.score += path_score;
      entry.path_count += 1;
      entry.depth = entry.depth == 0 ? next_depth : std::min(entry.depth, next_depth);
      entry.via_user_ids.insert(node.first_hop_user_id);

      if (next_depth < max_depth) {
        frontier.push(FrontierNode{
            .current_user_id = ref.target_id,
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
        aggregate_candidate.via_user_ids.size());
    std::transform(
        aggregate_candidate.via_user_ids.begin(),
        aggregate_candidate.via_user_ids.end(),
        via_user_ids.begin(),
        [&snapshot](const snapshot::StringInterner::Id via_id) {
          return snapshot.user_ids.value(via_id);
        });
    std::sort(via_user_ids.begin(), via_user_ids.end());
    result.push_back(contracts::MultiHopCandidate{
        .user_id = snapshot.user_ids.value(candidate_user_id),
        .score = aggregate_candidate.score,
        .depth = aggregate_candidate.depth,
        .path_count = aggregate_candidate.path_count,
        .via_user_ids = via_user_ids,
    });
  }
  return MultiHopBuildResult{
      .candidates = std::move(result),
      .visited_count = budget_tracker.visited_count(),
      .budget_exhausted = budget_tracker.exhausted(),
  };
}

void GraphStore::replace_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at) {
  auto next_snapshot = std::make_shared<SnapshotData>();
  next_snapshot->user_ids.reserve(edges.size() * 2);
  next_snapshot->edge_kind_ids.reserve(edges.size());
  auto& next_adjacency = next_snapshot->adjacency;
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
    const auto edge_kinds = snapshot::edge_kinds_from_record(edge);
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
    existing.daily_signal_counts = snapshot::add_counts(existing.daily_signal_counts, edge.daily_signal_counts);
    existing.rollup_signal_counts = snapshot::add_counts(existing.rollup_signal_counts, edge.rollup_signal_counts);
    snapshot::merge_edge_kinds(existing.edge_kinds, edge_kinds);
    existing.last_interaction_at_ms = snapshot::max_optional(existing.last_interaction_at_ms, edge.last_interaction_at_ms);
    existing.updated_at_ms = snapshot::max_optional(existing.updated_at_ms, edge.updated_at_ms);
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
      weights[i] = query::normalized_weight(neighbors[i]);
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

  snapshot::rebuild_dense_layout(*next_snapshot, next_adjacency);

  const auto user_interner_memory_bytes = next_snapshot->user_ids.memory_estimate_bytes();
  const auto edge_kind_interner_memory_bytes = next_snapshot->edge_kind_ids.memory_estimate_bytes();
  const auto csr_memory_estimate_bytes = snapshot::csr_memory_estimate_bytes(
      next_snapshot->dense_source_offsets,
      next_snapshot->dense_neighbors);
  const auto ranked_csr_memory_estimate_bytes = snapshot::csr_memory_estimate_bytes(
      next_snapshot->dense_ranked_source_offsets,
      next_snapshot->dense_ranked_neighbors);
  const auto memory_estimate_bytes = [&next_snapshot, &edge_kind_counts, user_interner_memory_bytes, edge_kind_interner_memory_bytes, csr_memory_estimate_bytes, ranked_csr_memory_estimate_bytes]() {
    std::size_t total = sizeof(SnapshotData);
    for (const auto& [user_id, neighbors] : next_snapshot->adjacency) {
      total += snapshot::string_capacity_bytes(user_id);
      total += snapshot::vector_storage_bytes(neighbors);
      for (const auto& neighbor : neighbors) {
        total += snapshot::string_capacity_bytes(neighbor.user_id);
        total += snapshot::string_vector_storage_bytes(neighbor.edge_kinds);
      }
    }
    for (const auto& [user_id, index] : next_snapshot->neighbors_by_user_id) {
      total += snapshot::string_capacity_bytes(user_id);
      total += snapshot::vector_storage_bytes(index);
    }
    for (const auto& [kind, count] : edge_kind_counts) {
      (void)count;
      total += snapshot::string_capacity_bytes(kind) + sizeof(std::size_t);
    }
    total += user_interner_memory_bytes;
    total += edge_kind_interner_memory_bytes;
    total += csr_memory_estimate_bytes;
    total += ranked_csr_memory_estimate_bytes;
    return total;
  }();
  const auto interner_memory_estimate_bytes = user_interner_memory_bytes + edge_kind_interner_memory_bytes;

  next_snapshot->metadata = SnapshotMetadata{
      .loaded = true,
      .edge_count = edges.size(),
      .vertex_count = vertices.size(),
      .dense_vertex_count = next_snapshot->user_ids.size(),
      .interned_edge_kind_count = next_snapshot->edge_kind_ids.size(),
      .interner_memory_estimate_bytes = interner_memory_estimate_bytes,
      .csr_source_count = next_snapshot->dense_source_offsets.empty() ? 0 : next_snapshot->dense_source_offsets.size() - 1,
      .csr_neighbor_count = next_snapshot->dense_neighbors.size(),
      .csr_memory_estimate_bytes = csr_memory_estimate_bytes,
      .ranked_csr_neighbor_count = next_snapshot->dense_ranked_neighbors.size(),
      .ranked_csr_memory_estimate_bytes = ranked_csr_memory_estimate_bytes,
      .memory_estimate_bytes = memory_estimate_bytes,
      .layout_version = "adjacency-v3-interned-csr",
      .snapshot_version = snapshot_version,
      .edge_kind_counts = std::move(edge_kind_counts),
      .loaded_at = loaded_at,
  };
  std::atomic_store_explicit(&snapshot_, std::shared_ptr<const SnapshotData>(std::move(next_snapshot)), std::memory_order_release);
}

std::shared_ptr<const GraphStore::SnapshotData> GraphStore::read_snapshot() const {
  return std::atomic_load_explicit(&snapshot_, std::memory_order_acquire);
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::rank_dense_neighbors(
    const std::span<const SnapshotData::DenseNeighborRef> neighbors,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids,
    const NeighborWeightFn weight_fn) {
  struct RankedNeighborRef {
    const WeightedNeighbor* neighbor;
    double weight;
  };

  const auto is_better = [](const RankedNeighborRef& left, const RankedNeighborRef& right) {
    if (std::abs(left.weight - right.weight) > 1e-9) {
      return left.weight > right.weight;
    }
    return left.neighbor->user_id < right.neighbor->user_id;
  };

  std::vector<RankedNeighborRef> top_refs;
  top_refs.reserve(std::min(neighbors.size(), limit));
  std::size_t available_count = 0;

  for (const auto& ref : neighbors) {
    const auto& neighbor = *ref.neighbor;
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    available_count += 1;
    if (limit == 0) {
      continue;
    }

    const auto candidate = RankedNeighborRef{
        .neighbor = &neighbor,
        .weight = weight_fn(neighbor),
    };
    if (top_refs.size() < limit) {
      top_refs.push_back(candidate);
      std::push_heap(top_refs.begin(), top_refs.end(), is_better);
      continue;
    }
    if (is_better(candidate, top_refs.front())) {
      std::pop_heap(top_refs.begin(), top_refs.end(), is_better);
      top_refs.back() = candidate;
      std::push_heap(top_refs.begin(), top_refs.end(), is_better);
    }
  }

  std::sort(top_refs.begin(), top_refs.end(), is_better);

  std::vector<contracts::NeighborCandidate> result;
  result.reserve(top_refs.size());
  for (const auto& ranked : top_refs) {
    const auto& neighbor = *ranked.neighbor;
    result.push_back(query::make_neighbor_candidate(neighbor, ranked.weight));
  }
  return QueryCandidates<contracts::NeighborCandidate>{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = neighbors.size(),
  };
}

std::span<const GraphStore::SnapshotData::DenseNeighborRef> GraphStore::read_dense_neighbor_index(
    const SnapshotData& snapshot,
    const std::string& user_id) {
  const auto source_id = snapshot.user_ids.find(user_id);
  if (!source_id.has_value()) {
    return {};
  }
  return read_dense_neighbor_index_by_id(snapshot, source_id.value());
}

std::span<const GraphStore::SnapshotData::DenseNeighborRef> GraphStore::read_dense_neighbor_index_by_id(
    const SnapshotData& snapshot,
    const snapshot::StringInterner::Id source_id) {
  if (source_id + 1 >= snapshot.dense_source_offsets.size()) {
    return {};
  }
  return telegram::graph::core::snapshot::read_csr_span(
      snapshot.dense_source_offsets,
      snapshot.dense_neighbors,
      source_id);
}

std::span<const GraphStore::SnapshotData::DenseNeighborRef> GraphStore::read_ranked_dense_neighbor_index(
    const SnapshotData& snapshot,
    const std::string& user_id) {
  const auto source_id = snapshot.user_ids.find(user_id);
  if (!source_id.has_value()) {
    return {};
  }
  return read_ranked_dense_neighbor_index_by_id(snapshot, source_id.value());
}

std::span<const GraphStore::SnapshotData::DenseNeighborRef> GraphStore::read_ranked_dense_neighbor_index_by_id(
    const SnapshotData& snapshot,
    const snapshot::StringInterner::Id source_id) {
  if (source_id + 1 >= snapshot.dense_ranked_source_offsets.size()) {
    return {};
  }
  return telegram::graph::core::snapshot::read_csr_span(
      snapshot.dense_ranked_source_offsets,
      snapshot.dense_ranked_neighbors,
      source_id);
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
  const auto neighbors = read_ranked_dense_neighbor_index(*snapshot, user_id);
  std::size_t available_count = 0;
  for (const auto& ref : neighbors) {
    const auto& neighbor = *ref.neighbor;
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    available_count += 1;
    if (result.size() < limit) {
      result.push_back(query::make_neighbor_candidate(neighbor, neighbor.score));
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
  return rank_dense_neighbors(
      read_ranked_dense_neighbor_index(*snapshot, user_id),
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
      read_ranked_dense_neighbor_index(*snapshot, user_id),
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
      read_ranked_dense_neighbor_index(*snapshot, user_id),
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
      read_ranked_dense_neighbor_index(*snapshot, user_id),
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
        .bridge_strength = query::bridge_strength(candidate),
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
  const auto neighbors_a = read_dense_neighbor_index(*snapshot, user_a_id);
  const auto neighbors_b = read_dense_neighbor_index(*snapshot, user_b_id);
  if (neighbors_a.empty() || neighbors_b.empty()) {
    return QueryCandidates<contracts::OverlapCandidate>{};
  }

  std::vector<contracts::OverlapCandidate> result;
  std::size_t index_a = 0;
  std::size_t index_b = 0;
  while (index_a < neighbors_a.size() && index_b < neighbors_b.size()) {
    const auto& ref_a = neighbors_a[index_a];
    const auto& ref_b = neighbors_b[index_b];
    if (ref_a.target_id < ref_b.target_id) {
      index_a += 1;
      continue;
    }
    if (ref_b.target_id < ref_a.target_id) {
      index_b += 1;
      continue;
    }
    const auto* neighbor_a = ref_a.neighbor;
    const auto* neighbor_b = ref_b.neighbor;
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
