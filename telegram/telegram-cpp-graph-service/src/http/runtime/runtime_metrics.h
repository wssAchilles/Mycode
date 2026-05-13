#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace telegram::graph::http {

struct HttpRuntimeSnapshot {
  std::uint64_t accepted_connections{0};
  std::uint64_t rejected_connections{0};
  std::uint64_t request_timeouts{0};
  std::uint64_t body_too_large{0};
  std::uint64_t invalid_requests{0};
  std::uint64_t internal_errors{0};
  std::size_t active_connections{0};
  std::size_t active_workers{0};
  std::size_t queue_depth{0};
  std::size_t max_queue_depth{0};
};

class HttpRuntimeMetrics {
 public:
  void record_accept() {
    accepted_connections_.fetch_add(1, std::memory_order_relaxed);
  }

  void record_reject() {
    rejected_connections_.fetch_add(1, std::memory_order_relaxed);
  }

  void record_read_error(int status_code) {
    switch (status_code) {
      case 408:
        request_timeouts_.fetch_add(1, std::memory_order_relaxed);
        break;
      case 413:
        body_too_large_.fetch_add(1, std::memory_order_relaxed);
        break;
      case 400:
        invalid_requests_.fetch_add(1, std::memory_order_relaxed);
        break;
      default:
        internal_errors_.fetch_add(1, std::memory_order_relaxed);
        break;
    }
  }

  void set_active_connections(std::size_t value) {
    active_connections_.store(value, std::memory_order_relaxed);
  }

  void worker_started() {
    active_workers_.fetch_add(1, std::memory_order_relaxed);
  }

  void worker_finished() {
    active_workers_.fetch_sub(1, std::memory_order_relaxed);
  }

  void set_queue_depth(std::size_t value) {
    queue_depth_.store(value, std::memory_order_relaxed);
    auto current = max_queue_depth_.load(std::memory_order_relaxed);
    while (value > current &&
           !max_queue_depth_.compare_exchange_weak(current, value, std::memory_order_relaxed)) {
    }
  }

  HttpRuntimeSnapshot snapshot() const {
    return HttpRuntimeSnapshot{
        .accepted_connections = accepted_connections_.load(std::memory_order_relaxed),
        .rejected_connections = rejected_connections_.load(std::memory_order_relaxed),
        .request_timeouts = request_timeouts_.load(std::memory_order_relaxed),
        .body_too_large = body_too_large_.load(std::memory_order_relaxed),
        .invalid_requests = invalid_requests_.load(std::memory_order_relaxed),
        .internal_errors = internal_errors_.load(std::memory_order_relaxed),
        .active_connections = active_connections_.load(std::memory_order_relaxed),
        .active_workers = active_workers_.load(std::memory_order_relaxed),
        .queue_depth = queue_depth_.load(std::memory_order_relaxed),
        .max_queue_depth = max_queue_depth_.load(std::memory_order_relaxed),
    };
  }

 private:
  std::atomic<std::uint64_t> accepted_connections_{0};
  std::atomic<std::uint64_t> rejected_connections_{0};
  std::atomic<std::uint64_t> request_timeouts_{0};
  std::atomic<std::uint64_t> body_too_large_{0};
  std::atomic<std::uint64_t> invalid_requests_{0};
  std::atomic<std::uint64_t> internal_errors_{0};
  std::atomic<std::size_t> active_connections_{0};
  std::atomic<std::size_t> active_workers_{0};
  std::atomic<std::size_t> queue_depth_{0};
  std::atomic<std::size_t> max_queue_depth_{0};
};

}  // namespace telegram::graph::http
