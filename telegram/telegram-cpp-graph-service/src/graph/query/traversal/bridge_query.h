#pragma once

#include <cstddef>
#include <vector>

#include "contracts/types.h"
#include "graph/query/traversal/ranker.h"
#include "graph/query/scoring.h"

namespace telegram::graph::core::query {

template <typename QueryCandidates>
QueryCandidates bridge_candidates_from_multi_hop(
    const std::vector<contracts::MultiHopCandidate>& candidates,
    const std::size_t limit,
    const std::size_t visited_count,
    const bool budget_exhausted) {
  std::vector<contracts::BridgeCandidate> result;
  result.reserve(candidates.size());
  for (const auto& candidate : candidates) {
    result.push_back(contracts::BridgeCandidate{
        .user_id = candidate.user_id,
        .score = candidate.score,
        .depth = candidate.depth,
        .path_count = candidate.path_count,
        .via_user_ids = candidate.via_user_ids,
        .bridge_strength = bridge_strength(candidate),
        .via_user_count = candidate.via_user_ids.size(),
    });
  }

  return rank_bridge_candidates<QueryCandidates>(
      std::move(result),
      limit,
      visited_count,
      budget_exhausted);
}

}  // namespace telegram::graph::core::query
