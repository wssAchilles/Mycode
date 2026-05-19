#pragma once

#include <algorithm>
#include <cstddef>
#include <span>
#include <string>
#include <unordered_set>

#include "graph/query/candidates.h"

namespace telegram::graph::core::query {

template <typename QueryCandidates, typename DenseNeighborRef>
QueryCandidates direct_neighbors(
    const std::span<const DenseNeighborRef> neighbors,
    const std::size_t limit,
    const std::unordered_set<std::uint32_t>& excluded_interned_ids) {
  QueryCandidates result;
  result.candidates.reserve(std::min(neighbors.size(), limit));
  result.scanned_count = neighbors.size();

  for (const auto& ref : neighbors) {
    if (excluded_interned_ids.contains(ref.target_id)) {
      continue;
    }
    const auto& neighbor = *ref.neighbor;
    result.available_count += 1;
    if (result.candidates.size() < limit) {
      result.candidates.push_back(make_neighbor_candidate(neighbor, neighbor.score));
    }
  }
  return result;
}

}  // namespace telegram::graph::core::query
