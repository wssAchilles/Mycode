#include "graph/graph_store.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <unordered_map>

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

// 默认实时叠加层过期窗口（10 分钟，覆盖两个 300 秒快照刷新周期）
constexpr std::int64_t kDefaultOverlayTtlMs = 10 * 60 * 1000;

void validate_snapshot_edges(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user) {
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
    const std::shared_ptr<const store::SnapshotData>& current_snapshot,
    const bool enforce_version_order) {
  if (snapshot == nullptr) {
    throw std::invalid_argument("snapshot must not be null");
  }
  // 冷启动无已加载非空快照时允许构建空 CSR 快照；若线上已有非空快照则拒绝被空边集冲掉
  if (snapshot->metadata.edge_count == 0 && current_snapshot != nullptr &&
      current_snapshot->metadata.loaded && current_snapshot->metadata.edge_count > 0) {
    throw std::invalid_argument("snapshot edges must not be empty when replacing non-empty snapshot");
  }
  if (snapshot->metadata.max_neighbors_per_user == 0) {
    throw std::invalid_argument("max_neighbors_per_user must be greater than 0");
  }
  if (snapshot->metadata.snapshot_version.empty()) {
    throw std::invalid_argument("snapshot version must not be empty");
  }
  if (snapshot->metadata.loaded_at <= std::chrono::system_clock::time_point{}) {
    throw std::invalid_argument("snapshot loaded_at must be after the Unix epoch");
  }
  if (enforce_version_order && current_snapshot != nullptr && current_snapshot->metadata.loaded &&
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

GraphStore::GraphStore()
    : GraphStore([] { return std::chrono::steady_clock::now(); }) {}

GraphStore::GraphStore(QueryClock query_clock)
    : query_clock_(std::move(query_clock)),
      delta_overlay_(std::make_shared<realtime::DeltaEdgeOverlay>()) {}

std::shared_ptr<realtime::DeltaEdgeOverlay> GraphStore::delta_overlay() const noexcept {
  return delta_overlay_;
}

void GraphStore::apply_edge_delta(
    const realtime::EdgeDeltaEvent& event,
    const std::int64_t now_ms) {
  if (delta_overlay_ != nullptr) {
    delta_overlay_->apply_edge_delta(event, now_ms);
  }
}

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
  validate_publishable_snapshot(snapshot, read_snapshot(), true);
  const auto loaded_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                             snapshot->metadata.loaded_at.time_since_epoch())
                             .count();
  snapshot_.publish(std::move(snapshot));
  if (delta_overlay_ != nullptr) {
    delta_overlay_->prune_expired(loaded_ms > 0 ? loaded_ms : request_now_ms(), kDefaultOverlayTtlMs);
  }
}

void GraphStore::publish_externally_pinned_snapshot(
    std::shared_ptr<const store::SnapshotData> snapshot) {
  validate_publishable_snapshot(snapshot, read_snapshot(), false);
  const auto loaded_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                             snapshot->metadata.loaded_at.time_since_epoch())
                             .count();
  snapshot_.publish(std::move(snapshot));
  if (delta_overlay_ != nullptr) {
    delta_overlay_->prune_expired(loaded_ms > 0 ? loaded_ms : request_now_ms(), kDefaultOverlayTtlMs);
  }
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

std::unordered_set<std::uint32_t> GraphStore::merged_excluded_ids(
    const SnapshotData& snapshot,
    const std::string& source_user_id,
    const std::unordered_set<std::string>& explicit_excluded) const {
  auto merged = intern_excluded_ids(snapshot, explicit_excluded);
  if (delta_overlay_ != nullptr) {
    const auto overlay_blocked = delta_overlay_->blocked_targets_for(source_user_id);
    for (const auto& id : overlay_blocked) {
      if (auto interned = snapshot.user_ids.find(id); interned.has_value()) {
        merged.insert(interned.value());
      }
    }
  }
  return merged;
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

void GraphStore::merge_realtime_follow_boosts(
    QueryCandidates<contracts::NeighborCandidate>& result,
    const NeighborQuery& query,
    const SnapshotData& snapshot,
    const std::unordered_set<std::uint32_t>& excluded_interned_ids,
    const bool align_social_scale) const {
  if (delta_overlay_ == nullptr) {
    return;
  }
  const auto boosts = delta_overlay_->follow_boosts_for(query.user_id);
  if (boosts.empty()) {
    return;
  }
  const auto overlay_blocked = delta_overlay_->blocked_targets_for(query.user_id);
  const auto dense_neighbors = store::read_ranked_dense_neighbor_index(snapshot, query.user_id);
  std::unordered_set<std::string> snapshot_available_ids;
  snapshot_available_ids.reserve(dense_neighbors.size());
  for (const auto& ref : dense_neighbors) {
    if (!excluded_interned_ids.contains(ref.target_id) && ref.neighbor != nullptr) {
      snapshot_available_ids.insert(ref.neighbor->user_id);
    }
  }

  std::unordered_map<std::string, std::size_t> candidate_index;
  candidate_index.reserve(result.candidates.size());
  for (std::size_t idx = 0; idx < result.candidates.size(); ++idx) {
    candidate_index.emplace(result.candidates[idx].user_id, idx);
  }

  bool modified = false;
  for (const auto& [target_id, raw_weight] : boosts) {
    if (target_id.empty() || target_id == query.user_id ||
        query.excluded_user_ids.contains(target_id) || overlay_blocked.contains(target_id)) {
      continue;
    }
    // 对齐 social_weight_at 中新鲜关注边的得分量纲（follow_bonus=2.0 + recency=0.5 + engagement=0.33）
    const double weight =
        align_social_scale ? std::max(raw_weight, raw_weight * 0.55 + 2.85) : raw_weight;
    if (!snapshot_available_ids.contains(target_id)) {
      result.available_count += 1;
    }
    if (query.limit == 0) {
      continue;
    }
    if (auto it = candidate_index.find(target_id); it != candidate_index.end()) {
      auto& existing = result.candidates[it->second];
      existing.score = std::max(existing.score, weight);
      if (std::find(existing.relation_kinds.begin(), existing.relation_kinds.end(), "realtime_follow") ==
          existing.relation_kinds.end()) {
        existing.relation_kinds.push_back("realtime_follow");
      }
      modified = true;
      continue;
    }
    candidate_index.emplace(target_id, result.candidates.size());
    result.candidates.push_back(contracts::NeighborCandidate{
        .user_id = target_id,
        .score = weight,
        .relation_kinds = {"realtime_follow"},
    });
    modified = true;
  }

  if (query.limit == 0) {
    result.candidates.clear();
    return;
  }
  if (modified) {
    std::sort(
        result.candidates.begin(),
        result.candidates.end(),
        [](const auto& left, const auto& right) {
          if (left.score != right.score) {
            return left.score > right.score;
          }
          return left.user_id < right.user_id;
        });
    if (result.candidates.size() > query.limit) {
      result.candidates.resize(query.limit);
    }
  }
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::direct_neighbors(
    const NeighborQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return QueryCandidates<contracts::NeighborCandidate>{};
  }
  const auto neighbors = store::read_ranked_dense_neighbor_index(*snapshot, query.user_id);
  const auto excluded = merged_excluded_ids(*snapshot, query.user_id, query.excluded_user_ids);
  auto result = query::direct_neighbors<QueryCandidates<contracts::NeighborCandidate>>(
      neighbors,
      query.limit,
      excluded);
  merge_realtime_follow_boosts(result, query, *snapshot, excluded);
  return with_snapshot_diagnostics(std::move(result), *snapshot);
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
  return social_neighbors_from_snapshot(query, *snapshot, request_now_ms());
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::social_neighbors_from_snapshot(
    const NeighborQuery& query,
    const SnapshotData& snapshot,
    const std::int64_t now_ms) const {
  const auto excluded = merged_excluded_ids(snapshot, query.user_id, query.excluded_user_ids);
  auto result = rank_dense_neighbors(
      store::read_ranked_dense_neighbor_index(snapshot, query.user_id),
      query.limit,
      excluded,
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::social_weight_at(neighbor, now_ms);
      });
  // 在 social_neighbors 与 /graph/batch 主链路统一融合实时新关注增补边
  merge_realtime_follow_boosts(result, query, snapshot, excluded, /*align_social_scale=*/true);
  return with_snapshot_diagnostics(std::move(result), snapshot);
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
  return recent_engagers_from_snapshot(query, *snapshot, request_now_ms());
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::recent_engagers_from_snapshot(
    const NeighborQuery& query,
    const SnapshotData& snapshot,
    const std::int64_t now_ms) const {
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(snapshot, query.user_id),
          query.limit,
          merged_excluded_ids(snapshot, query.user_id, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::recent_engager_weight_at(neighbor, now_ms);
          }),
      snapshot);
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
  return co_engagers_from_snapshot(query, *snapshot, request_now_ms());
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::co_engagers_from_snapshot(
    const NeighborQuery& query,
    const SnapshotData& snapshot,
    const std::int64_t now_ms) const {
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(snapshot, query.user_id),
          query.limit,
          merged_excluded_ids(snapshot, query.user_id, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::co_engager_weight_at(neighbor, now_ms);
          }),
      snapshot);
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
  return content_affinity_neighbors_from_snapshot(query, *snapshot, request_now_ms());
}

QueryCandidates<contracts::NeighborCandidate> GraphStore::content_affinity_neighbors_from_snapshot(
    const NeighborQuery& query,
    const SnapshotData& snapshot,
    const std::int64_t now_ms) const {
  return with_snapshot_diagnostics(
      rank_dense_neighbors(
          store::read_ranked_dense_neighbor_index(snapshot, query.user_id),
          query.limit,
          merged_excluded_ids(snapshot, query.user_id, query.excluded_user_ids),
          [now_ms](const WeightedNeighbor& neighbor) {
            return query::content_affinity_weight_at(neighbor, now_ms);
          }),
      snapshot);
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
      merged_excluded_ids(*snapshot, query.user_id, query.excluded_user_ids),
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
      build_result.scanned_count,
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
  return bridge_users_from_snapshot(query, *snapshot, request_now_ms());
}

QueryCandidates<contracts::BridgeCandidate> GraphStore::bridge_users_from_snapshot(
    const TraversalQuery& query,
    const SnapshotData& snapshot,
    const std::int64_t now_ms) const {
  const auto source_id = snapshot.user_ids.find(query.user_id);
  if (!source_id.has_value()) {
    return with_snapshot_diagnostics(QueryCandidates<contracts::BridgeCandidate>{}, snapshot);
  }
  auto build_result = query::build_multi_hop_candidates<snapshot::StringInterner::Id>(
      source_id.value(),
      store::read_ranked_dense_neighbor_index_by_id(snapshot, source_id.value()),
      merged_excluded_ids(snapshot, query.user_id, query.excluded_user_ids),
      query::TraversalOptions{
          .max_depth = query.max_depth,
          .max_branching_factor = query.max_branching_factor,
          .max_visited_nodes = query.max_visited_nodes,
          .max_candidates = query.max_candidates,
          .exclude_direct_neighbors = query.exclude_direct_neighbors,
          .best_first = traversal_best_first_enabled_,
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return snapshot.user_ids.value(id);
      },
      [&snapshot](const snapshot::StringInterner::Id id) {
        return store::read_ranked_dense_neighbor_index_by_id(snapshot, id);
      },
      [now_ms](const WeightedNeighbor& neighbor) {
        return query::normalized_weight_at(neighbor, now_ms);
      });
  auto result = query::bridge_candidates_from_multi_hop<QueryCandidates<contracts::BridgeCandidate>>(
      build_result.candidates,
      query.limit,
      build_result.scanned_count,
      build_result.visited_count,
      build_result.budget_exhausted);
  result.pruned_count = build_result.pruned_count;
  result.frontier_max_size = build_result.frontier_max_size;
  return with_snapshot_diagnostics(std::move(result), snapshot);
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

std::optional<GraphStore::BatchQueryCandidates> GraphStore::batch(
    const GraphBatchQuery& query) const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return std::nullopt;
  }

  const auto now_ms = request_now_ms();
  const auto neighbor_query = NeighborQuery{
      .user_id = query.user_id,
      .limit = query.direct_limit,
      .excluded_user_ids = query.excluded_user_ids,
  };
  const auto bridge_query = TraversalQuery{
      .user_id = query.user_id,
      .limit = query.bridge_limit,
      .max_depth = query.max_depth,
      .max_branching_factor = query.max_branching_factor,
      .max_visited_nodes = query.max_visited_nodes,
      .max_candidates = query.max_candidates,
      .excluded_user_ids = query.excluded_user_ids,
      .exclude_direct_neighbors = true,
  };

  const auto social_neighbors_started_at = query_clock_();
  auto social_neighbors_result = social_neighbors_from_snapshot(neighbor_query, *snapshot, now_ms);
  const auto social_neighbors_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      query_clock_() - social_neighbors_started_at);

  const auto recent_engagers_started_at = query_clock_();
  auto recent_engagers_result = recent_engagers_from_snapshot(neighbor_query, *snapshot, now_ms);
  const auto recent_engagers_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      query_clock_() - recent_engagers_started_at);

  const auto bridge_users_started_at = query_clock_();
  auto bridge_users_result = bridge_users_from_snapshot(bridge_query, *snapshot, now_ms);
  const auto bridge_users_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      query_clock_() - bridge_users_started_at);

  const auto co_engagers_started_at = query_clock_();
  auto co_engagers_result = co_engagers_from_snapshot(neighbor_query, *snapshot, now_ms);
  const auto co_engagers_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      query_clock_() - co_engagers_started_at);

  const auto content_affinity_neighbors_started_at = query_clock_();
  auto content_affinity_neighbors_result =
      content_affinity_neighbors_from_snapshot(neighbor_query, *snapshot, now_ms);
  const auto content_affinity_neighbors_duration =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          query_clock_() - content_affinity_neighbors_started_at);

  return BatchQueryCandidates{
      .snapshot_version = snapshot->metadata.snapshot_version,
      .snapshot_loaded_at = snapshot->metadata.loaded_at,
      .social_neighbors = std::move(social_neighbors_result),
      .recent_engagers = std::move(recent_engagers_result),
      .bridge_users = std::move(bridge_users_result),
      .co_engagers = std::move(co_engagers_result),
      .content_affinity_neighbors = std::move(content_affinity_neighbors_result),
      .durations = BatchQueryDurations{
          .social_neighbors = social_neighbors_duration,
          .recent_engagers = recent_engagers_duration,
          .bridge_users = bridge_users_duration,
          .co_engagers = co_engagers_duration,
          .content_affinity_neighbors = content_affinity_neighbors_duration,
      },
  };
}

std::vector<GraphStore::AuthorCredScore> GraphStore::author_cred_scores(
    const std::vector<std::string>& author_ids) const {
  const auto snapshot = read_snapshot();
  std::vector<AuthorCredScore> out;
  out.reserve(author_ids.size());

  for (const auto& author_id : author_ids) {
    std::size_t in_degree = 0;
    double total_in_weight = 0.0;
    if (snapshot != nullptr) {
      if (auto it = snapshot->author_in_stats.find(author_id);
          it != snapshot->author_in_stats.end()) {
        in_degree = it->second.in_degree;
        total_in_weight = it->second.total_in_weight;
      }
    }
    const double penalty =
        delta_overlay_ != nullptr ? delta_overlay_->penalty_for_author(author_id) : 0.0;
    // 基于对数入度与入边累积权重的局部图谱先验分，并实时扣减取关/拉黑负反馈惩罚
    const double raw_prior =
        in_degree == 0 && total_in_weight <= 0.0
            ? 0.5
            : std::min(1.0, 0.35 + 0.15 * std::log1p(static_cast<double>(in_degree)) +
                                0.12 * std::log1p(std::max(0.0, total_in_weight)));
    const double cred = std::clamp(raw_prior - penalty, 0.0, 1.0);
    out.push_back(AuthorCredScore{
        .author_id = author_id,
        .author_cred_score = cred,
        .in_degree = in_degree,
        .total_in_weight = total_in_weight,
        .negative_penalty = penalty,
    });
  }
  return out;
}

SnapshotMetadata GraphStore::metadata() const {
  const auto snapshot = read_snapshot();
  if (snapshot == nullptr) {
    return SnapshotMetadata{};
  }
  return snapshot->metadata;
}

}  // namespace telegram::graph::core
