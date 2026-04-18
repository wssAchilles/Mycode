#pragma once

#include <chrono>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include "config/config.h"
#include "graph/graph_store.h"

namespace telegram::graph::ops {

class GraphServiceMetrics {
 public:
  struct QueryStats {
    std::uint64_t requests{0};
    std::uint64_t empty_results{0};
    std::uint64_t last_duration_ms{0};
    std::deque<std::uint64_t> duration_samples;
    std::unordered_map<std::string, std::uint64_t> empty_reason_counts;
  };

  void record_query(
      const std::string& kind,
      std::size_t result_count,
      std::chrono::milliseconds duration,
      const std::optional<std::string>& empty_reason);

  void record_refresh_success(
      const core::SnapshotMetadata& metadata,
      std::chrono::milliseconds duration,
      std::chrono::system_clock::time_point completed_at);

  void record_refresh_failure(
      const std::string& error_message,
      std::chrono::milliseconds duration,
      std::chrono::system_clock::time_point completed_at);

  nlohmann::json ops_payload(
      const config::ServiceConfig& config,
      const core::SnapshotMetadata& metadata) const;

  nlohmann::json summary_payload(
      const config::ServiceConfig& config,
      const core::SnapshotMetadata& metadata) const;

 private:
  static std::string to_iso_string(std::chrono::system_clock::time_point value);

  mutable std::mutex mutex_;
  std::uint64_t total_requests_{0};
  std::unordered_map<std::string, QueryStats> query_stats_;
  std::uint64_t refresh_successes_{0};
  std::uint64_t refresh_failures_{0};
  std::optional<std::string> last_error_;
  std::optional<std::string> last_refresh_completed_at_;
  std::optional<std::uint64_t> last_refresh_duration_ms_;
};

}  // namespace telegram::graph::ops
