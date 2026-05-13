#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <queue>
#include <span>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "contracts/types.h"
#include "graph/query/budget.h"
#include "graph/ranking.h"

namespace telegram::graph::core::query {

struct TraversalOptions {
  std::size_t max_depth{0};
  std::size_t max_branching_factor{0};
  std::size_t max_visited_nodes{0};
  std::size_t max_candidates{0};
  bool exclude_direct_neighbors{false};
};

struct MultiHopBuildResult {
  std::vector<contracts::MultiHopCandidate> candidates;
  std::size_t visited_count{0};
  bool budget_exhausted{false};
};

template <typename InternerId, typename DenseNeighborRef, typename ResolveUserId, typename ReadRankedNeighbors, typename WeightFn>
MultiHopBuildResult build_multi_hop_candidates(
    const InternerId source_id,
    const std::span<const DenseNeighborRef> direct_neighbors,
    const std::unordered_set<std::string>& excluded_user_ids,
    const TraversalOptions& options,
    ResolveUserId resolve_user_id,
    ReadRankedNeighbors read_ranked_neighbors,
    WeightFn weight_fn) {
  if (direct_neighbors.empty()) {
    return {};
  }

  std::unordered_set<InternerId> direct_neighbor_ids;
  direct_neighbor_ids.reserve(direct_neighbors.size());
  for (const auto& ref : direct_neighbors) {
    direct_neighbor_ids.insert(ref.target_id);
  }

  struct FrontierNode {
    InternerId current_user_id;
    InternerId first_hop_user_id;
    double accumulated_score;
    std::size_t depth;
  };

  struct AggregateCandidate {
    double score{0.0};
    std::size_t depth{0};
    std::size_t path_count{0};
    std::unordered_set<InternerId> via_user_ids;
  };

  std::queue<FrontierNode> frontier;
  for (const auto& ref : direct_neighbors) {
    frontier.push(FrontierNode{
        .current_user_id = ref.target_id,
        .first_hop_user_id = ref.target_id,
        .accumulated_score = weight_fn(*ref.neighbor),
        .depth = 1,
    });
  }

  std::unordered_map<InternerId, AggregateCandidate> aggregate;
  TraversalBudgetTracker budget_tracker(TraversalBudget{
      .max_visited_nodes = options.max_visited_nodes,
      .max_candidates = options.max_candidates,
  });

  while (!frontier.empty()) {
    const auto node = frontier.front();
    frontier.pop();
    if (!budget_tracker.record_visit()) {
      break;
    }
    if (node.depth >= options.max_depth) {
      continue;
    }

    const auto next_neighbors = read_ranked_neighbors(node.current_user_id);
    const auto branching_limit = std::min(next_neighbors.size(), options.max_branching_factor);
    for (std::size_t index = 0; index < branching_limit; index += 1) {
      const auto& ref = next_neighbors[index];
      const auto& candidate = *ref.neighbor;
      if (ref.target_id == source_id || excluded_user_ids.contains(candidate.user_id)) {
        continue;
      }
      if (options.exclude_direct_neighbors && direct_neighbor_ids.contains(ref.target_id)) {
        continue;
      }

      const auto next_depth = node.depth + 1;
      const auto path_score = node.accumulated_score * weight_fn(candidate);
      const auto existing_entry = aggregate.find(ref.target_id);
      if (existing_entry == aggregate.end() && !budget_tracker.can_add_new_candidate(aggregate.size())) {
        continue;
      }

      auto& entry = aggregate[ref.target_id];
      entry.score += path_score;
      entry.path_count += 1;
      entry.depth = entry.depth == 0 ? next_depth : std::min(entry.depth, next_depth);
      entry.via_user_ids.insert(node.first_hop_user_id);

      if (next_depth < options.max_depth) {
        frontier.push(FrontierNode{
            .current_user_id = ref.target_id,
            .first_hop_user_id = node.first_hop_user_id,
            .accumulated_score = path_score,
            .depth = next_depth,
        });
      }
    }
  }

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

  return MultiHopBuildResult{
      .candidates = std::move(result),
      .visited_count = budget_tracker.visited_count(),
      .budget_exhausted = budget_tracker.exhausted(),
  };
}

template <typename QueryCandidates>
QueryCandidates rank_multi_hop_candidates(
    std::vector<contracts::MultiHopCandidate> candidates,
    const std::size_t limit,
    const std::size_t visited_count,
    const bool budget_exhausted) {
  const auto available_count = candidates.size();
  ranking::sort_top_k(
      candidates.begin(),
      candidates.end(),
      limit,
      [](const contracts::MultiHopCandidate& left, const contracts::MultiHopCandidate& right) {
        if (std::abs(left.score - right.score) > 1e-9) {
          return left.score > right.score;
        }
        if (left.depth != right.depth) {
          return left.depth < right.depth;
        }
        return left.user_id < right.user_id;
      });
  if (candidates.size() > limit) {
    candidates.resize(limit);
  }

  return QueryCandidates{
      .candidates = std::move(candidates),
      .available_count = available_count,
      .scanned_count = visited_count,
      .visited_count = visited_count,
      .budget_exhausted = budget_exhausted,
  };
}

}  // namespace telegram::graph::core::query
