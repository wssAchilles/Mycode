#pragma once

#include <cmath>
#include <cstddef>
#include <utility>
#include <vector>

#include "contracts/types.h"
#include "graph/ranking.h"

namespace telegram::graph::core::query {

inline bool better_multi_hop_candidate(
    const contracts::MultiHopCandidate& left,
    const contracts::MultiHopCandidate& right) {
  if (std::abs(left.score - right.score) > 1e-9) {
    return left.score > right.score;
  }
  if (left.depth != right.depth) {
    return left.depth < right.depth;
  }
  return left.user_id < right.user_id;
}

inline bool better_bridge_candidate(
    const contracts::BridgeCandidate& left,
    const contracts::BridgeCandidate& right) {
  if (std::abs(left.bridge_strength - right.bridge_strength) > 1e-9) {
    return left.bridge_strength > right.bridge_strength;
  }
  if (left.depth != right.depth) {
    return left.depth < right.depth;
  }
  return left.user_id < right.user_id;
}

template <typename Candidate, typename Comparator>
void rank_and_trim(std::vector<Candidate>& candidates, const std::size_t limit, Comparator comparator) {
  ranking::sort_top_k(candidates.begin(), candidates.end(), limit, comparator);
  if (candidates.size() > limit) {
    candidates.resize(limit);
  }
}

template <typename QueryCandidates>
QueryCandidates rank_multi_hop_candidates(
    std::vector<contracts::MultiHopCandidate> candidates,
    const std::size_t limit,
    const std::size_t visited_count,
    const bool budget_exhausted) {
  const auto available_count = candidates.size();
  rank_and_trim(candidates, limit, better_multi_hop_candidate);

  return QueryCandidates{
      .candidates = std::move(candidates),
      .available_count = available_count,
      .scanned_count = visited_count,
      .visited_count = visited_count,
      .budget_exhausted = budget_exhausted,
  };
}

template <typename QueryCandidates>
QueryCandidates rank_bridge_candidates(
    std::vector<contracts::BridgeCandidate> candidates,
    const std::size_t limit,
    const std::size_t visited_count,
    const bool budget_exhausted) {
  const auto available_count = candidates.size();
  rank_and_trim(candidates, limit, better_bridge_candidate);

  return QueryCandidates{
      .candidates = std::move(candidates),
      .available_count = available_count,
      .scanned_count = visited_count,
      .visited_count = visited_count,
      .budget_exhausted = budget_exhausted,
  };
}

}  // namespace telegram::graph::core::query
