#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <span>
#include <string>
#include <unordered_set>
#include <vector>

#include "graph/query/candidates.h"

namespace telegram::graph::core::query {

template <typename QueryCandidates, typename DenseNeighborRef, typename WeightFn>
QueryCandidates rank_neighbors(
    const std::span<const DenseNeighborRef> neighbors,
    const std::size_t limit,
    const std::unordered_set<std::string>& excluded_user_ids,
    WeightFn weight_fn) {
  struct RankedNeighborRef {
    const WeightedNeighbor* neighbor;
    double weight;
  };

  const auto is_better = [](const RankedNeighborRef& left, const RankedNeighborRef& right) {
    if (std::abs(left.weight - right.weight) > 1e-9) {
      return left.weight > right.weight;
    }
    return left.neighbor->user_id < right.neighbor->user_id;
  };

  std::vector<RankedNeighborRef> top_refs;
  top_refs.reserve(std::min(neighbors.size(), limit));
  std::size_t available_count = 0;

  for (const auto& ref : neighbors) {
    const auto& neighbor = *ref.neighbor;
    if (excluded_user_ids.contains(neighbor.user_id)) {
      continue;
    }
    available_count += 1;
    if (limit == 0) {
      continue;
    }

    const auto candidate = RankedNeighborRef{
        .neighbor = &neighbor,
        .weight = weight_fn(neighbor),
    };
    if (top_refs.size() < limit) {
      top_refs.push_back(candidate);
      std::push_heap(top_refs.begin(), top_refs.end(), is_better);
      continue;
    }
    if (is_better(candidate, top_refs.front())) {
      std::pop_heap(top_refs.begin(), top_refs.end(), is_better);
      top_refs.back() = candidate;
      std::push_heap(top_refs.begin(), top_refs.end(), is_better);
    }
  }

  std::sort(top_refs.begin(), top_refs.end(), is_better);

  QueryCandidates result;
  result.candidates.reserve(top_refs.size());
  for (const auto& ranked : top_refs) {
    result.candidates.push_back(make_neighbor_candidate(*ranked.neighbor, ranked.weight));
  }
  result.available_count = available_count;
  result.scanned_count = neighbors.size();
  return result;
}

}  // namespace telegram::graph::core::query
