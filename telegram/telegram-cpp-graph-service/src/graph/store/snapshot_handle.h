#pragma once

#include <memory>

namespace telegram::graph::core::store {

template <typename SnapshotData>
class SnapshotHandle {
 public:
  void publish(std::shared_ptr<SnapshotData> snapshot) {
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
