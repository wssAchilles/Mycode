#pragma once

#include <memory>
#include <mutex>

namespace telegram::graph::core::store {

template <typename SnapshotData>
class SnapshotHandle {
 public:
  SnapshotHandle() = default;
  SnapshotHandle(const SnapshotHandle&) = delete;
  SnapshotHandle& operator=(const SnapshotHandle&) = delete;

  SnapshotHandle(SnapshotHandle&& other) noexcept {
    std::lock_guard lock(other.mutex_);
    snapshot_ = std::move(other.snapshot_);
    previous_snapshot_ = std::move(other.previous_snapshot_);
  }

  SnapshotHandle& operator=(SnapshotHandle&& other) noexcept {
    if (this == &other) {
      return *this;
    }
    std::scoped_lock lock(mutex_, other.mutex_);
    snapshot_ = std::move(other.snapshot_);
    previous_snapshot_ = std::move(other.previous_snapshot_);
    return *this;
  }

  void publish(std::shared_ptr<const SnapshotData> snapshot) {
    std::lock_guard lock(mutex_);
    previous_snapshot_ = std::move(snapshot_);
    snapshot_ = std::move(snapshot);
  }

  bool rollback() {
    std::lock_guard lock(mutex_);
    if (previous_snapshot_ == nullptr) {
      return false;
    }
    snapshot_.swap(previous_snapshot_);
    return true;
  }

  std::shared_ptr<const SnapshotData> read() const {
    std::lock_guard lock(mutex_);
    return snapshot_;
  }

 private:
  mutable std::mutex mutex_;
  std::shared_ptr<const SnapshotData> snapshot_;
  std::shared_ptr<const SnapshotData> previous_snapshot_;
};

}  // namespace telegram::graph::core::store
