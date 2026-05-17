#pragma once

#include <memory>

namespace telegram::graph::core::store {

template <typename SnapshotData>
class SnapshotHandle {
 public:
  void publish(std::shared_ptr<const SnapshotData> snapshot) {
    // NOTE: std::atomic_store/load are deprecated in C++20 in favor of
    // std::atomic<std::shared_ptr>>, but libc++ on macOS does not yet
    // fully support the C++20 specialization. Revisit when toolchain
    // support matures.
    std::atomic_store_explicit(
        &snapshot_,
        std::shared_ptr<const SnapshotData>(std::move(snapshot)),
        std::memory_order_release);
  }

  std::shared_ptr<const SnapshotData> read() const {
    return std::atomic_load_explicit(&snapshot_, std::memory_order_acquire);
  }

 private:
  std::shared_ptr<const SnapshotData> snapshot_;
};

}  // namespace telegram::graph::core::store
