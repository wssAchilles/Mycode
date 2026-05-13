#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <utility>
#include <vector>

#include "contracts/types.h"
#include "graph/query/scoring.h"
#include "graph/ranking.h"

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
  if (result.size() > limit) {
    result.resize(limit);
  }

  return QueryCandidates{
      .candidates = std::move(result),
      .available_count = available_count,
      .scanned_count = visited_count,
      .visited_count = visited_count,
      .budget_exhausted = budget_exhausted,
  };
}

}  // namespace telegram::graph::core::query
