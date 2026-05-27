#pragma once

#include <cstddef>
#include <memory_resource>
#include <queue>
#include <span>

namespace telegram::graph::core::query {

template <typename InternerId>
struct FrontierNode {
  InternerId current_user_id;
  InternerId first_hop_user_id;
  double accumulated_score;
  std::size_t depth;
};

/// Seed frontier with arena-backed deque to avoid per-node heap allocations.
template <typename InternerId, typename DenseNeighborRef, typename WeightFn>
std::queue<FrontierNode<InternerId>, std::pmr::deque<FrontierNode<InternerId>>>
seed_frontier(
    const std::span<const DenseNeighborRef> direct_neighbors,
    WeightFn weight_fn,
    std::pmr::memory_resource* resource = std::pmr::get_default_resource()) {
  std::queue<FrontierNode<InternerId>, std::pmr::deque<FrontierNode<InternerId>>>
      frontier(resource);
  for (const auto& ref : direct_neighbors) {
    frontier.push(FrontierNode<InternerId>{
        .current_user_id = ref.target_id,
        .first_hop_user_id = ref.target_id,
        .accumulated_score = weight_fn(*ref.neighbor),
        .depth = 1,
    });
  }
  return frontier;
}

}  // namespace telegram::graph::core::query
