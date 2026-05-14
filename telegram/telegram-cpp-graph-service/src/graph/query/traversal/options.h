#pragma once

#include <cstddef>

namespace telegram::graph::core::query {

struct TraversalOptions {
  std::size_t max_depth{0};
  std::size_t max_branching_factor{0};
  std::size_t max_visited_nodes{0};
  std::size_t max_candidates{0};
  bool exclude_direct_neighbors{false};
};

}  // namespace telegram::graph::core::query
