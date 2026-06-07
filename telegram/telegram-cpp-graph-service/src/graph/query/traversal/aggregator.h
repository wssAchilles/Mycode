#pragma once

#include <algorithm>
#include <cstddef>
#include <memory_resource>
#include <span>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "contracts/types.h"
#include "graph/query/arena.h"

namespace telegram::graph::core::query {

template <typename InternerId>
struct AggregateCandidate {
  double score{0.0};
  std::size_t depth{0};
  std::size_t path_count{0};
  std::pmr::vector<InternerId> via_user_ids;
};

template <typename InternerId>
using AggregateCandidates = std::pmr::unordered_map<InternerId, AggregateCandidate<InternerId>>;

template <typename InternerId, typename DenseNeighborRef>
std::pmr::unordered_set<InternerId> collect_direct_neighbor_ids(
    const std::span<const DenseNeighborRef> direct_neighbors,
    std::pmr::memory_resource* resource) {
  std::pmr::unordered_set<InternerId> ids(resource);
  ids.reserve(direct_neighbors.size());
  for (const auto& ref : direct_neighbors) {
    ids.insert(ref.target_id);
  }
  return ids;
}

template <typename InternerId>
void record_aggregate_candidate(
    AggregateCandidates<InternerId>& aggregate,
    const InternerId candidate_user_id,
    const InternerId via_user_id,
    const double path_score,
    const std::size_t depth) {
  auto [it, inserted] = aggregate.try_emplace(candidate_user_id);
  auto& entry = it->second;
  entry.score += path_score;
  entry.path_count += 1;
  entry.depth = inserted ? depth : std::min(entry.depth, depth);
  entry.via_user_ids.push_back(via_user_id);
}

template <typename InternerId, typename ResolveUserId>
std::vector<contracts::MultiHopCandidate> materialize_multi_hop_candidates(
    AggregateCandidates<InternerId>& aggregate,
    ResolveUserId resolve_user_id) {
  std::vector<contracts::MultiHopCandidate> result;
  result.reserve(aggregate.size());
  for (auto& [candidate_user_id, aggregate_candidate] : aggregate) {
    auto& via_ids = aggregate_candidate.via_user_ids;
    std::sort(via_ids.begin(), via_ids.end());
    via_ids.erase(std::unique(via_ids.begin(), via_ids.end()), via_ids.end());

    std::vector<std::string> via_user_ids(via_ids.size());
    std::transform(via_ids.begin(), via_ids.end(), via_user_ids.begin(), resolve_user_id);
    std::sort(via_user_ids.begin(), via_user_ids.end());
    result.push_back(contracts::MultiHopCandidate{
        .user_id = resolve_user_id(candidate_user_id),
        .score = aggregate_candidate.score,
        .depth = aggregate_candidate.depth,
        .path_count = aggregate_candidate.path_count,
        .via_user_ids = via_user_ids,
    });
  }
  return result;
}

}  // namespace telegram::graph::core::query
