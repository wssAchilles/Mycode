#pragma once

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

#include "contracts/types.h"
#include "graph/snapshot/assembly/edge_grouping.h"
#include "graph/snapshot/assembly/neighbor_index.h"
#include "graph/snapshot/assembly/neighbor_retention.h"
#include "graph/snapshot/dense_layout.h"
#include "graph/snapshot/metadata_builder.h"
#include "graph/snapshot/node_reordering.h"

namespace telegram::graph::core::snapshot {

template <typename SnapshotData, typename WeightedNeighbor>
class SnapshotAssembler {
 public:
  explicit SnapshotAssembler(const std::size_t expected_edge_count = 0)
      : next_snapshot_(std::make_shared<SnapshotData>()) {
    if (expected_edge_count > 0) {
      next_snapshot_->user_ids.reserve(expected_edge_count * 2);
      next_snapshot_->edge_kind_ids.reserve(expected_edge_count);
      grouped_.vertices.reserve(expected_edge_count * 2);
      grouped_.adjacency.reserve(expected_edge_count);
    }
  }

  void ingest_edges(const std::span<const contracts::SnapshotEdgeRecord> edges) {
    const auto started = std::chrono::steady_clock::now();
    edge_count_ += edges.size();
    for (const auto& edge : edges) {
      grouped_.vertices.insert(edge.source_user_id);
      grouped_.vertices.insert(edge.target_user_id);
      (void)next_snapshot_->user_ids.intern(edge.source_user_id);
      (void)next_snapshot_->user_ids.intern(edge.target_user_id);

      const auto edge_kinds = edge_kinds_from_record(edge);
      for (const auto& kind : edge_kinds) {
        (void)next_snapshot_->edge_kind_ids.intern(kind);
        grouped_.edge_kind_counts[kind] += 1;
      }

      auto& target_map = grouped_.adjacency[edge.source_user_id];
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
    add_duration("ingest", started);
  }

  template <typename WeightFn>
  std::shared_ptr<SnapshotData> finish(
      const std::size_t max_neighbors_per_user,
      const std::string& snapshot_version,
      const std::chrono::system_clock::time_point loaded_at,
      WeightFn weight_fn) {
    auto& adjacency = next_snapshot_->adjacency;
    {
      const auto started = std::chrono::steady_clock::now();
      build::populate_adjacency(adjacency, grouped_.adjacency);
      add_duration("adjacency", started);
    }

    {
      const auto started = std::chrono::steady_clock::now();
      auto bfs_order = telegram::graph::snapshot::compute_bfs_order_from_weighted(adjacency);
      if (!bfs_order.empty()) {
        std::vector<std::string> ordered_ids(next_snapshot_->user_ids.size());
        for (std::size_t i = 0; i < next_snapshot_->user_ids.size(); ++i) {
          ordered_ids[i] = next_snapshot_->user_ids.value(static_cast<uint32_t>(i));
        }
        std::sort(ordered_ids.begin(), ordered_ids.end(),
                  [&bfs_order](const std::string& a, const std::string& b) {
                    auto it_a = bfs_order.find(a);
                    auto it_b = bfs_order.find(b);
                    const auto rank_a = it_a != bfs_order.end() ? it_a->second : UINT32_MAX;
                    const auto rank_b = it_b != bfs_order.end() ? it_b->second : UINT32_MAX;
                    return rank_a < rank_b;
                  });
        StringInterner reordered;
        reordered.reserve(ordered_ids.size());
        for (const auto& id : ordered_ids) {
          reordered.intern(id);
        }
        next_snapshot_->user_ids = std::move(reordered);
      }
      add_duration("nodeReorder", started);
    }

    {
      const auto started = std::chrono::steady_clock::now();
      build::retain_top_neighbors_per_source(adjacency, max_neighbors_per_user, weight_fn);
      add_duration("retention", started);
    }
    {
      const auto started = std::chrono::steady_clock::now();
      build::rebuild_neighbor_pointer_index(*next_snapshot_, adjacency);
      add_duration("pointerIndex", started);
    }
    {
      const auto started = std::chrono::steady_clock::now();
      rebuild_dense_layout(*next_snapshot_, adjacency);
      add_duration("csrLayout", started);
    }
    {
      const auto started = std::chrono::steady_clock::now();
      next_snapshot_->metadata = build_metadata(
          *next_snapshot_,
          edge_count_,
          grouped_.vertices.size(),
          std::move(grouped_.edge_kind_counts),
          snapshot_version,
          loaded_at,
          build_phase_duration_ms_);
      add_duration("metadata", started);
      next_snapshot_->metadata.build_phase_duration_ms = build_phase_duration_ms_;
    }
    return std::move(next_snapshot_);
  }

  [[nodiscard]] const std::unordered_map<std::string, std::uint64_t>& build_phase_duration_ms() const {
    return build_phase_duration_ms_;
  }

  [[nodiscard]] std::size_t edge_count() const {
    return edge_count_;
  }

 private:
  void add_duration(const std::string& phase, const std::chrono::steady_clock::time_point started) {
    build_phase_duration_ms_[phase] += static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count());
  }

  std::shared_ptr<SnapshotData> next_snapshot_;
  build::GroupedEdges<WeightedNeighbor> grouped_;
  std::unordered_map<std::string, std::uint64_t> build_phase_duration_ms_;
  std::size_t edge_count_{0};
};

template <typename SnapshotData, typename WeightedNeighbor, typename WeightFn>
std::shared_ptr<SnapshotData> build_snapshot(
    const std::vector<contracts::SnapshotEdgeRecord>& edges,
    const std::size_t max_neighbors_per_user,
    const std::string& snapshot_version,
    const std::chrono::system_clock::time_point loaded_at,
    WeightFn weight_fn) {
  std::unordered_map<std::string, std::uint64_t> build_phase_duration_ms;
  const auto add_duration = [&build_phase_duration_ms](
                                const std::string& phase,
                                const std::chrono::steady_clock::time_point started) {
    build_phase_duration_ms[phase] += static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count());
  };

  auto next_snapshot = std::make_shared<SnapshotData>();
  next_snapshot->user_ids.reserve(edges.size() * 2);
  next_snapshot->edge_kind_ids.reserve(edges.size());

  const auto grouping_started = std::chrono::steady_clock::now();
  auto grouped = build::group_edges<SnapshotData, WeightedNeighbor>(edges, *next_snapshot);
  add_duration("ingest", grouping_started);

  auto& adjacency = next_snapshot->adjacency;
  {
    const auto started = std::chrono::steady_clock::now();
    build::populate_adjacency(adjacency, grouped.adjacency);
    add_duration("adjacency", started);
  }

  {
    const auto started = std::chrono::steady_clock::now();
    auto bfs_order = telegram::graph::snapshot::compute_bfs_order_from_weighted(adjacency);
    if (!bfs_order.empty()) {
      std::vector<std::string> ordered_ids(next_snapshot->user_ids.size());
      for (std::size_t i = 0; i < next_snapshot->user_ids.size(); ++i) {
        ordered_ids[i] = next_snapshot->user_ids.value(static_cast<uint32_t>(i));
      }
      std::sort(ordered_ids.begin(), ordered_ids.end(),
                [&bfs_order](const std::string& a, const std::string& b) {
                  auto it_a = bfs_order.find(a);
                  auto it_b = bfs_order.find(b);
                  const auto rank_a = it_a != bfs_order.end() ? it_a->second : UINT32_MAX;
                  const auto rank_b = it_b != bfs_order.end() ? it_b->second : UINT32_MAX;
                  return rank_a < rank_b;
                });
      StringInterner reordered;
      reordered.reserve(ordered_ids.size());
      for (const auto& id : ordered_ids) {
        reordered.intern(id);
      }
      next_snapshot->user_ids = std::move(reordered);
    }
    add_duration("nodeReorder", started);
  }

  {
    const auto started = std::chrono::steady_clock::now();
    build::retain_top_neighbors_per_source(adjacency, max_neighbors_per_user, weight_fn);
    add_duration("retention", started);
  }
  {
    const auto started = std::chrono::steady_clock::now();
    build::rebuild_neighbor_pointer_index(*next_snapshot, adjacency);
    add_duration("pointerIndex", started);
  }
  {
    const auto started = std::chrono::steady_clock::now();
    rebuild_dense_layout(*next_snapshot, adjacency);
    add_duration("csrLayout", started);
  }
  {
    const auto started = std::chrono::steady_clock::now();
    next_snapshot->metadata = build_metadata(
        *next_snapshot,
        edges.size(),
        grouped.vertices.size(),
        std::move(grouped.edge_kind_counts),
        snapshot_version,
        loaded_at,
        build_phase_duration_ms);
    add_duration("metadata", started);
    next_snapshot->metadata.build_phase_duration_ms = std::move(build_phase_duration_ms);
  }
  return next_snapshot;
}

}  // namespace telegram::graph::core::snapshot
