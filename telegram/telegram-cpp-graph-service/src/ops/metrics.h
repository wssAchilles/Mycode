#pragma once

#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "config/config.h"
#include "graph/graph_store.h"

namespace telegram::graph::ops {

class GraphServiceMetrics {
 public:
  void record_request(const std::string& kind);

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
  std::uint64_t neighbor_requests_{0};
  std::uint64_t social_neighbor_requests_{0};
  std::uint64_t recent_engager_requests_{0};
  std::uint64_t multi_hop_requests_{0};
  std::uint64_t bridge_user_requests_{0};
  std::uint64_t author_candidate_requests_{0};
  std::uint64_t overlap_requests_{0};
  std::uint64_t refresh_successes_{0};
  std::uint64_t refresh_failures_{0};
  std::optional<std::string> last_error_;
  std::optional<std::string> last_refresh_completed_at_;
  std::optional<std::uint64_t> last_refresh_duration_ms_;
};

}  // namespace telegram::graph::ops
