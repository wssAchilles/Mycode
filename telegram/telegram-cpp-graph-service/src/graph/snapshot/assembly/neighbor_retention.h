#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <numeric>
#include <vector>

#include "graph/ranking.h"

namespace telegram::graph::core::snapshot::build {

template <typename WeightedNeighbor, typename WeightFn>
void retain_top_neighbors(
    std::vector<WeightedNeighbor>& neighbors,
    const std::size_t max_neighbors_per_user,
    WeightFn weight_fn) {
  std::vector<double> weights(neighbors.size());
  for (std::size_t i = 0; i < neighbors.size(); ++i) {
    weights[i] = weight_fn(neighbors[i]);
  }

  std::vector<std::size_t> indices(neighbors.size());
  std::iota(indices.begin(), indices.end(), 0);
  const auto retained_count = std::min(neighbors.size(), max_neighbors_per_user);
  ranking::sort_top_k(
      indices.begin(),
      indices.end(),
      retained_count,
      [&](const std::size_t left, const std::size_t right) {
        if (std::abs(weights[left] - weights[right]) > 1e-9) {
          return weights[left] > weights[right];
        }
        return neighbors[left].user_id < neighbors[right].user_id;
      });

  std::vector<WeightedNeighbor> sorted;
  sorted.reserve(retained_count);
  for (std::size_t i = 0; i < retained_count; ++i) {
    sorted.push_back(std::move(neighbors[indices[i]]));
  }
  neighbors = std::move(sorted);
}

template <typename Adjacency, typename WeightFn>
void retain_top_neighbors_per_source(
    Adjacency& adjacency,
    const std::size_t max_neighbors_per_user,
    WeightFn weight_fn) {
  for (auto& [user_id, neighbors] : adjacency) {
    (void)user_id;
    retain_top_neighbors(neighbors, max_neighbors_per_user, weight_fn);
  }
}

}  // namespace telegram::graph::core::snapshot::build
