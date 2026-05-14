#pragma once

#include <algorithm>
#include <cstddef>
#include <span>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "contracts/types.h"

namespace telegram::graph::core::query {

template <typename InternerId>
struct AggregateCandidate {
  double score{0.0};
  std::size_t depth{0};
  std::size_t path_count{0};
  std::unordered_set<InternerId> via_user_ids;
};

template <typename InternerId>
using AggregateCandidates = std::unordered_map<InternerId, AggregateCandidate<InternerId>>;

template <typename InternerId, typename DenseNeighborRef>
std::unordered_set<InternerId> collect_direct_neighbor_ids(
    const std::span<const DenseNeighborRef> direct_neighbors) {
  std::unordered_set<InternerId> ids;
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
  auto& entry = aggregate[candidate_user_id];
  entry.score += path_score;
  entry.path_count += 1;
  entry.depth = entry.depth == 0 ? depth : std::min(entry.depth, depth);
  entry.via_user_ids.insert(via_user_id);
}

template <typename InternerId, typename ResolveUserId>
std::vector<contracts::MultiHopCandidate> materialize_multi_hop_candidates(
    AggregateCandidates<InternerId>& aggregate,
    ResolveUserId resolve_user_id) {
  std::vector<contracts::MultiHopCandidate> result;
  result.reserve(aggregate.size());
  for (auto& [candidate_user_id, aggregate_candidate] : aggregate) {
    std::vector<std::string> via_user_ids(aggregate_candidate.via_user_ids.size());
    std::transform(
        aggregate_candidate.via_user_ids.begin(),
        aggregate_candidate.via_user_ids.end(),
        via_user_ids.begin(),
        resolve_user_id);
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
