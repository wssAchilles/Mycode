#pragma once

#include <cstddef>
#include <vector>

#include "contracts/types.h"

namespace telegram::graph::core::query {

struct MultiHopBuildResult {
  std::vector<contracts::MultiHopCandidate> candidates;
  std::size_t visited_count{0};
  std::size_t pruned_count{0};
  std::size_t frontier_max_size{0};
  bool budget_exhausted{false};
};

}  // namespace telegram::graph::core::query
