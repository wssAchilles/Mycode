#pragma once

#include "contracts/types.h"
#include "graph/graph_store.h"
#include "graph/query/scoring.h"

namespace telegram::graph::core::query {

inline contracts::NeighborCandidate make_neighbor_candidate(
    const GraphStore::WeightedNeighbor& neighbor,
    const double score) {
  return contracts::NeighborCandidate{
      .user_id = neighbor.user_id,
      .score = score,
      .interaction_probability = neighbor.interaction_probability,
      .engagement_score = positive_engagement(neighbor.rollup_signal_counts),
      .recentness_score = recentness_signal(neighbor.last_interaction_at_ms),
      .relation_kinds = relation_kinds(neighbor),
  };
}

}  // namespace telegram::graph::core::query
