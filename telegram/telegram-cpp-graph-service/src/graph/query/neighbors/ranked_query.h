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

  // Min-heap comparator: worst element at front for efficient top-K replacement.
  // std::push_heap / std::pop_heap place the "smallest" element at front,
  // so we reverse the comparison: lower weight = "worse" = "smaller" in heap order.
  const auto is_worse = [](const RankedNeighborRef& left, const RankedNeighborRef& right) {
    if (std::abs(left.weight - right.weight) > 1e-9) {
      return left.weight < right.weight;
    }
    return left.neighbor->user_id > right.neighbor->user_id;
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
      std::push_heap(top_refs.begin(), top_refs.end(), is_worse);
      continue;
    }
    // Replace the worst element (front of min-heap) if candidate is better.
    if (candidate.weight > top_refs.front().weight) {
      std::pop_heap(top_refs.begin(), top_refs.end(), is_worse);
      top_refs.back() = candidate;
      std::push_heap(top_refs.begin(), top_refs.end(), is_worse);
    }
  }

  // Sort best-to-worst for final output.
  const auto is_better = [](const RankedNeighborRef& left, const RankedNeighborRef& right) {
    if (std::abs(left.weight - right.weight) > 1e-9) {
      return left.weight > right.weight;
    }
    return left.neighbor->user_id < right.neighbor->user_id;
  };
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
