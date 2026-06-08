#pragma once

#include <algorithm>
#include <cstddef>
#include <functional>
#include <memory_resource>
#include <span>
#include <vector>

namespace telegram::graph::core::query {

template <typename InternerId>
struct FrontierNode {
  InternerId current_user_id;
  InternerId first_hop_user_id;
  double accumulated_score;
  std::size_t depth;
};

template <typename InternerId>
struct FrontierNodeGreater {
  bool operator()(const FrontierNode<InternerId>& lhs, const FrontierNode<InternerId>& rhs) const {
    if (lhs.accumulated_score != rhs.accumulated_score) {
      return lhs.accumulated_score < rhs.accumulated_score;
    }
    if (lhs.depth != rhs.depth) {
      return lhs.depth > rhs.depth;
    }
    if (lhs.current_user_id != rhs.current_user_id) {
      return lhs.current_user_id > rhs.current_user_id;
    }
    return lhs.first_hop_user_id > rhs.first_hop_user_id;
  }
};

template <typename InternerId>
class Frontier {
 public:
  explicit Frontier(
      const bool best_first = false,
      std::pmr::memory_resource* resource = std::pmr::get_default_resource())
      : best_first_(best_first), nodes_(resource) {}

  void push(FrontierNode<InternerId> node) {
    nodes_.push_back(node);
    max_size_ = std::max(max_size_, size());
    if (best_first_) {
      std::push_heap(nodes_.begin(), nodes_.end(), FrontierNodeGreater<InternerId>{});
    }
  }

  [[nodiscard]] FrontierNode<InternerId> pop() {
    if (best_first_) {
      std::pop_heap(nodes_.begin(), nodes_.end(), FrontierNodeGreater<InternerId>{});
      auto node = nodes_.back();
      nodes_.pop_back();
      return node;
    }
    auto node = nodes_[head_];
    head_ += 1;
    return node;
  }

  [[nodiscard]] bool empty() const {
    return head_ >= nodes_.size();
  }

  [[nodiscard]] std::size_t max_size() const {
    return max_size_;
  }

 private:
  [[nodiscard]] std::size_t size() const {
    return nodes_.size() - head_;
  }

  bool best_first_{false};
  std::pmr::vector<FrontierNode<InternerId>> nodes_;
  std::size_t head_{0};
  std::size_t max_size_{0};
};

/// Seed frontier with arena-backed heap for score-prioritized expansion.
template <typename InternerId, typename DenseNeighborRef, typename WeightFn>
Frontier<InternerId>
seed_frontier(
    const std::span<const DenseNeighborRef> direct_neighbors,
    WeightFn weight_fn,
    const bool best_first = false,
    std::pmr::memory_resource* resource = std::pmr::get_default_resource()) {
  Frontier<InternerId> frontier(best_first, resource);
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
