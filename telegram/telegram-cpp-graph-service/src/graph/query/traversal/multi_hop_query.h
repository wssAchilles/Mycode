#pragma once

#include <cstddef>
#include <memory_resource>
#include <span>
#include <string>
#include <unordered_set>
#include <utility>

#include "graph/query/arena.h"
#include "graph/query/budget.h"
#include "graph/query/traversal/aggregator.h"
#include "graph/query/traversal/frontier.h"
#include "graph/query/traversal/options.h"
#include "graph/query/traversal/ranker.h"
#include "graph/query/traversal/result.h"

namespace telegram::graph::core::query {

template <typename InternerId, typename DenseNeighborRef, typename ResolveUserId, typename ReadRankedNeighbors, typename WeightFn>
MultiHopBuildResult build_multi_hop_candidates(
    const InternerId source_id,
    const std::span<const DenseNeighborRef> direct_neighbors,
    const std::unordered_set<InternerId>& excluded_interned_ids,
    const TraversalOptions& options,
    ResolveUserId resolve_user_id,
    ReadRankedNeighbors read_ranked_neighbors,
    WeightFn weight_fn) {
  if (direct_neighbors.empty()) {
    return {};
  }

  // Request-scoped monotonic arena for BFS temporaries.
  // The visited set, direct neighbor set, and aggregate map (including
  // per-candidate via_user_ids sets) are all allocated from this arena
  // and freed in bulk at function exit.
  QueryArena<> arena;

  const auto direct_neighbor_ids = collect_direct_neighbor_ids<InternerId>(direct_neighbors, arena.resource());
  auto frontier = seed_frontier<InternerId>(direct_neighbors, weight_fn);
  AggregateCandidates<InternerId> aggregate(arena.resource());
  std::pmr::unordered_set<InternerId> visited(arena.resource());
  visited.reserve(options.max_visited_nodes);
  TraversalBudgetTracker budget_tracker(TraversalBudget{
      .max_visited_nodes = options.max_visited_nodes,
      .max_candidates = options.max_candidates,
  });

  while (!frontier.empty()) {
    const auto node = frontier.front();
    frontier.pop();
    if (!visited.insert(node.current_user_id).second) {
      continue;
    }
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

      // Prefetch upcoming neighbor data to hide pointer-chasing latency.
      // 4 entries ahead: BFS inner loop is heavier per iteration.
      if (index + 4 < branching_limit) {
        __builtin_prefetch(next_neighbors[index + 4].neighbor, 0, 1);
      }

      const auto& candidate = *ref.neighbor;
      if (ref.target_id == source_id || excluded_interned_ids.contains(ref.target_id)) {
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
      record_aggregate_candidate(aggregate, ref.target_id, node.first_hop_user_id, path_score, next_depth);

      if (next_depth < options.max_depth) {
        frontier.push(FrontierNode<InternerId>{
            .current_user_id = ref.target_id,
            .first_hop_user_id = node.first_hop_user_id,
            .accumulated_score = path_score,
            .depth = next_depth,
        });
      }
    }
  }

  return MultiHopBuildResult{
      .candidates = materialize_multi_hop_candidates(aggregate, resolve_user_id),
      .visited_count = budget_tracker.visited_count(),
      .budget_exhausted = budget_tracker.exhausted(),
  };
}

}  // namespace telegram::graph::core::query
