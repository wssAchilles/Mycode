#pragma once

#include "graph/query/overlap/simd_intersection.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <span>
#include <utility>
#include <vector>

#include "contracts/types.h"
#include "graph/ranking.h"

namespace telegram::graph::core::query {

inline bool better_overlap_candidate(
    const contracts::OverlapCandidate& left,
    const contracts::OverlapCandidate& right) {
  if (std::abs(left.combined_score - right.combined_score) > 1e-9) {
    return left.combined_score > right.combined_score;
  }
  return left.user_id < right.user_id;
}

template <typename QueryCandidates, typename DenseNeighborRef>
QueryCandidates overlap_candidates(
    const std::span<const DenseNeighborRef> neighbors_a,
    const std::span<const DenseNeighborRef> neighbors_b,
    const std::size_t limit) {
  if (neighbors_a.empty() || neighbors_b.empty()) {
    return QueryCandidates{};
  }

  std::vector<contracts::OverlapCandidate> top_candidates;
  if (limit > 0) {
    top_candidates.reserve(limit);
  }
  std::size_t available_count = 0;
  std::size_t index_a = 0;
  std::size_t index_b = 0;
  while (index_a < neighbors_a.size() && index_b < neighbors_b.size()) {
    const auto& ref_a = neighbors_a[index_a];
    const auto& ref_b = neighbors_b[index_b];
    if (ref_a.target_id < ref_b.target_id) {
      index_a += 1;
      continue;
    }
    if (ref_b.target_id < ref_a.target_id) {
      index_b += 1;
      continue;
    }

    const auto* neighbor_a = ref_a.neighbor;
    const auto* neighbor_b = ref_b.neighbor;
    available_count += 1;
    if (limit == 0) {
      index_a += 1;
      index_b += 1;
      continue;
    }

    auto candidate = contracts::OverlapCandidate{
        .user_id = neighbor_a->user_id,
        .combined_score = neighbor_a->score + neighbor_b->score,
        .user_a_score = neighbor_a->score,
        .user_b_score = neighbor_b->score,
    };
    if (top_candidates.size() < limit) {
      top_candidates.push_back(std::move(candidate));
      std::push_heap(top_candidates.begin(), top_candidates.end(), better_overlap_candidate);
    } else {
      if (better_overlap_candidate(candidate, top_candidates.front())) {
        std::pop_heap(top_candidates.begin(), top_candidates.end(), better_overlap_candidate);
        top_candidates.back() = std::move(candidate);
        std::push_heap(top_candidates.begin(), top_candidates.end(), better_overlap_candidate);
      }
    }
    index_a += 1;
    index_b += 1;
  }

  std::sort(top_candidates.begin(), top_candidates.end(), better_overlap_candidate);

  return QueryCandidates{
      .candidates = std::move(top_candidates),
      .available_count = available_count,
      .scanned_count = neighbors_a.size() + neighbors_b.size(),
  };
}

template <typename QueryCandidates, typename DenseNeighborRef>
QueryCandidates overlap_candidates_materialized(
    const std::span<const DenseNeighborRef> neighbors_a,
    const std::span<const DenseNeighborRef> neighbors_b,
    const std::size_t limit) {
  if (neighbors_a.empty() || neighbors_b.empty()) {
    return QueryCandidates{};
  }

  std::vector<contracts::OverlapCandidate> candidates;
  candidates.reserve(std::min(neighbors_a.size(), neighbors_b.size()));
  std::size_t index_a = 0;
  std::size_t index_b = 0;
  while (index_a < neighbors_a.size() && index_b < neighbors_b.size()) {
    const auto& ref_a = neighbors_a[index_a];
    const auto& ref_b = neighbors_b[index_b];
    if (ref_a.target_id < ref_b.target_id) {
      index_a += 1;
      continue;
    }
    if (ref_b.target_id < ref_a.target_id) {
      index_b += 1;
      continue;
    }

    const auto* neighbor_a = ref_a.neighbor;
    const auto* neighbor_b = ref_b.neighbor;
    candidates.push_back(contracts::OverlapCandidate{
        .user_id = neighbor_a->user_id,
        .combined_score = neighbor_a->score + neighbor_b->score,
        .user_a_score = neighbor_a->score,
        .user_b_score = neighbor_b->score,
    });
    index_a += 1;
    index_b += 1;
  }

  const auto available_count = candidates.size();
  ranking::sort_top_k(candidates.begin(), candidates.end(), limit, better_overlap_candidate);
  if (candidates.size() > limit) {
    candidates.resize(limit);
  }

  return QueryCandidates{
      .candidates = std::move(candidates),
      .available_count = available_count,
      .scanned_count = neighbors_a.size() + neighbors_b.size(),
  };
}

}  // namespace telegram::graph::core::query
