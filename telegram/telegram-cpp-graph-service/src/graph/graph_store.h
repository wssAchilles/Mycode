#pragma once

#include <chrono>
#include <cstddef>
#include <optional>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "contracts/types.h"

namespace telegram::graph::core {

struct SnapshotMetadata {
  bool loaded{false};
  std::size_t edge_count{0};
  std::size_t vertex_count{0};
  std::string snapshot_version;
  std::chrono::system_clock::time_point loaded_at{};
};

class GraphStore {
 public:
  struct WeightedNeighbor {
    std::string user_id;
    double score{0.0};
    double interaction_probability{0.0};
  };

  void replace_snapshot(
      const std::vector<contracts::SnapshotEdgeRecord>& edges,
      std::size_t max_neighbors_per_user,
      const std::string& snapshot_version,
      std::chrono::system_clock::time_point loaded_at);

  std::vector<contracts::NeighborCandidate> direct_neighbors(
      const std::string& user_id,
      std::size_t limit,
      const std::unordered_set<std::string>& excluded_user_ids) const;

  std::vector<contracts::MultiHopCandidate> multi_hop_candidates(
      const std::string& user_id,
      std::size_t limit,
      std::size_t max_depth,
      std::size_t max_branching_factor,
      const std::unordered_set<std::string>& excluded_user_ids,
      bool exclude_direct_neighbors) const;

  std::vector<contracts::OverlapCandidate> overlap_candidates(
      const std::string& user_a_id,
      const std::string& user_b_id,
      std::size_t limit) const;

  SnapshotMetadata metadata() const;

 private:
  std::vector<WeightedNeighbor> read_neighbors(const std::string& user_id) const;

  mutable std::shared_mutex mutex_;
  std::unordered_map<std::string, std::vector<WeightedNeighbor>> adjacency_;
  SnapshotMetadata metadata_;
};

}  // namespace telegram::graph::core
