#pragma once

#include <cstddef>

namespace telegram::graph::core::query {

struct TraversalBudget {
  std::size_t max_visited_nodes{0};
  std::size_t max_candidates{0};
};

class TraversalBudgetTracker {
 public:
  explicit TraversalBudgetTracker(TraversalBudget budget) : budget_(budget) {}

  bool record_visit() {
    visited_count_ += 1;
    if (budget_.max_visited_nodes > 0 && visited_count_ >= budget_.max_visited_nodes) {
      exhausted_ = true;
      return false;
    }
    return true;
  }

  bool can_add_new_candidate(const std::size_t current_candidate_count) {
    if (budget_.max_candidates > 0 && current_candidate_count >= budget_.max_candidates) {
      exhausted_ = true;
      return false;
    }
    return true;
  }

  std::size_t visited_count() const {
    return visited_count_;
  }

  bool exhausted() const {
    return exhausted_;
  }

 private:
  TraversalBudget budget_;
  std::size_t visited_count_{0};
  bool exhausted_{false};
};

}  // namespace telegram::graph::core::query
