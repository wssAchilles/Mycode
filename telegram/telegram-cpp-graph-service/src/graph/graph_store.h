#pragma once

#include <chrono>
#include <cstddef>
#include <memory>
#include <span>
#include <string>
#include <unordered_set>
#include <vector>

#include "contracts/types.h"
#include "graph/domain/weighted_neighbor.h"
#include "graph/snapshot/metadata.h"
#include "graph/store/snapshot_data.h"

namespace telegram::graph::core {

class GraphStore {
 public:
  template <typename T>
  struct QueryCandidates {
    std::vector<T> candidates;
    std::size_t available_count{0};
    std::size_t scanned_count{0};
    std::size_t visited_count{0};
    bool budget_exhausted{false};
  };

  using WeightedNeighbor = domain::WeightedNeighbor;

  void replace_snapshot(
      const std::vector<contracts::SnapshotEdgeRecord>& edges,
      std::size_t max_neighbors_per_user,
      const std::string& snapshot_version,
      std::chrono::system_clock::time_point loaded_at);

  QueryCandidates<contracts::NeighborCandidate> direct_neighbors(
      const std::string& user_id,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids) const;

  QueryCandidates<contracts::NeighborCandidate> social_neighbors(
      const std::string& user_id,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids) const;

  QueryCandidates<contracts::NeighborCandidate> recent_engagers(
      const std::string& user_id,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids) const;

  QueryCandidates<contracts::NeighborCandidate> co_engagers(
      const std::string& user_id,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids) const;

  QueryCandidates<contracts::NeighborCandidate> content_affinity_neighbors(
      const std::string& user_id,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids) const;

  QueryCandidates<contracts::MultiHopCandidate> multi_hop_candidates(
      const std::string& user_id,
      std::size_t limit,
      std::size_t max_depth,
      std::size_t max_branching_factor,
      std::size_t max_visited_nodes,
      std::size_t max_candidates,
      const std::unordered_set<std::string>& excluded_user_ids,
      bool exclude_direct_neighbors) const;

  QueryCandidates<contracts::BridgeCandidate> bridge_users(
      const std::string& user_id,
      std::size_t limit,
      std::size_t max_depth,
      std::size_t max_branching_factor,
      std::size_t max_visited_nodes,
      std::size_t max_candidates,
      const std::unordered_set<std::string>& excluded_user_ids,
      bool exclude_direct_neighbors) const;

  QueryCandidates<contracts::OverlapCandidate> overlap_candidates(
      const std::string& user_a_id,
      const std::string& user_b_id,
      std::size_t limit) const;

  SnapshotMetadata metadata() const;

 private:
  using SnapshotData = store::SnapshotData;
  using NeighborWeightFn = double (*)(const WeightedNeighbor&);

  std::shared_ptr<const SnapshotData> read_snapshot() const;
  static QueryCandidates<contracts::NeighborCandidate> rank_dense_neighbors(
      std::span<const SnapshotData::DenseNeighborRef> neighbors,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids,
      NeighborWeightFn weight_fn);
  std::shared_ptr<const SnapshotData> snapshot_;
};

}  // namespace telegram::graph::core
