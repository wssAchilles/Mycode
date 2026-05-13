#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "contracts/types.h"

namespace telegram::graph::core::domain {

struct WeightedNeighbor {
  std::string user_id;
  double score{0.0};
  double interaction_probability{0.0};
  contracts::EdgeSignalCounts daily_signal_counts;
  contracts::EdgeSignalCounts rollup_signal_counts;
  std::vector<std::string> edge_kinds;
  std::optional<std::int64_t> last_interaction_at_ms;
  std::optional<std::int64_t> updated_at_ms;
};

}  // namespace telegram::graph::core::domain
