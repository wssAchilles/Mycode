#include "ops/metrics.h"

#include <algorithm>
#include <iomanip>
#include <sstream>
#include <vector>

namespace telegram::graph::ops {
namespace {

constexpr std::size_t kLatencySampleCapacity = 128;

std::string status_for(const core::SnapshotMetadata& metadata, std::uint64_t refresh_failures) {
  if (!metadata.loaded) {
    return refresh_failures == 0 ? "bootstrap" : "degraded";
  }
  return refresh_failures > 0 ? "degraded" : "healthy";
}

nlohmann::json edge_kind_counts_json(const std::unordered_map<std::string, std::size_t>& edge_kind_counts) {
  auto result = nlohmann::json::object();
  for (const auto& [kind, count] : edge_kind_counts) {
    result[kind] = count;
  }
  return result;
}

nlohmann::json query_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& [kind, stats] : query_stats) {
    result[kind] = stats.requests;
  }
  return result;
}

nlohmann::json kernel_query_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind :
       {"social_neighbors", "recent_engagers", "co_engagers", "content_affinity_neighbors", "bridge_users"}) {
    const auto iterator = query_stats.find(kind);
    result[kind] = iterator == query_stats.end() ? 0 : iterator->second.requests;
  }
  return result;
}

nlohmann::json source_empty_rate_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind :
       {"social_neighbors", "recent_engagers", "co_engagers", "content_affinity_neighbors", "bridge_users"}) {
    const auto iterator = query_stats.find(kind);
    if (iterator == query_stats.end() || iterator->second.requests == 0) {
      result[kind] = 0.0;
      continue;
    }
    result[kind] = static_cast<double>(iterator->second.empty_results) /
                   static_cast<double>(iterator->second.requests);
  }
  return result;
}

std::uint64_t percentile(const std::deque<std::uint64_t>& values, const std::size_t percentile_value) {
  if (values.empty()) {
    return 0;
  }

  auto sorted = std::vector<std::uint64_t>(values.begin(), values.end());
  std::sort(sorted.begin(), sorted.end());
  const auto clamped = std::min<std::size_t>(100, percentile_value);
  const auto index = ((sorted.size() - 1) * clamped) / 100;
  return sorted[index];
}

nlohmann::json kernel_latency_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind :
       {"social_neighbors", "recent_engagers", "co_engagers", "content_affinity_neighbors", "bridge_users"}) {
    const auto iterator = query_stats.find(kind);
    const auto stats =
        iterator == query_stats.end() ? GraphServiceMetrics::QueryStats{} : iterator->second;
    result[kind] = nlohmann::json{
        {"lastMs", stats.last_duration_ms},
        {"p50Ms", percentile(stats.duration_samples, 50)},
        {"p95Ms", percentile(stats.duration_samples, 95)},
    };
  }
  return result;
}

nlohmann::json empty_reason_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind :
       {"social_neighbors", "recent_engagers", "co_engagers", "content_affinity_neighbors", "bridge_users"}) {
    auto per_kernel = nlohmann::json::object();
    const auto iterator = query_stats.find(kind);
    if (iterator != query_stats.end()) {
      for (const auto& [reason, count] : iterator->second.empty_reason_counts) {
        per_kernel[reason] = count;
      }
    }
    result[kind] = per_kernel;
  }
  return result;
}

nlohmann::json kernel_budget_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind :
       {"social_neighbors", "recent_engagers", "co_engagers", "content_affinity_neighbors", "bridge_users"}) {
    const auto iterator = query_stats.find(kind);
    const auto stats =
        iterator == query_stats.end() ? GraphServiceMetrics::QueryStats{} : iterator->second;
    result[kind] = nlohmann::json{
        {"lastRequestedLimit", stats.last_requested_limit},
        {"lastAvailableCount", stats.last_available_count},
        {"lastReturnedCount", stats.last_returned_count},
        {"lastTruncatedCount", stats.last_truncated_count},
        {"budgetExhaustedCount", stats.budget_exhausted_count},
    };
  }
  return result;
}

}  // namespace

void GraphServiceMetrics::record_query(
    const std::string& kind,
    const std::size_t requested_limit,
    const std::size_t available_count,
    const std::size_t result_count,
    const std::chrono::milliseconds duration,
    const std::optional<std::string>& empty_reason) {
  std::lock_guard lock(mutex_);
  total_requests_ += 1;
  auto& stats = query_stats_[kind];
  stats.requests += 1;
  stats.last_duration_ms = static_cast<std::uint64_t>(duration.count());
  stats.last_requested_limit = requested_limit;
  stats.last_available_count = available_count;
  stats.last_returned_count = result_count;
  stats.last_truncated_count =
      available_count > result_count ? available_count - result_count : 0;
  if (stats.last_truncated_count > 0) {
    stats.budget_exhausted_count += 1;
  }
  stats.duration_samples.push_back(stats.last_duration_ms);
  while (stats.duration_samples.size() > kLatencySampleCapacity) {
    stats.duration_samples.pop_front();
  }
  if (result_count == 0) {
    stats.empty_results += 1;
    const auto reason = empty_reason.has_value() && !empty_reason->empty() ? empty_reason.value() : "no_candidates";
    stats.empty_reason_counts[reason] += 1;
  }
}

void GraphServiceMetrics::record_refresh_success(
    const core::SnapshotMetadata&,
    std::chrono::milliseconds duration,
    std::chrono::system_clock::time_point completed_at) {
  std::lock_guard lock(mutex_);
  refresh_successes_ += 1;
  last_error_.reset();
  last_refresh_completed_at_ = to_iso_string(completed_at);
  last_refresh_duration_ms_ = static_cast<std::uint64_t>(duration.count());
}

void GraphServiceMetrics::record_refresh_failure(
    const std::string& error_message,
    std::chrono::milliseconds duration,
    std::chrono::system_clock::time_point completed_at) {
  std::lock_guard lock(mutex_);
  refresh_failures_ += 1;
  last_error_ = error_message;
  last_refresh_completed_at_ = to_iso_string(completed_at);
  last_refresh_duration_ms_ = static_cast<std::uint64_t>(duration.count());
}

nlohmann::json GraphServiceMetrics::ops_payload(
    const config::ServiceConfig& config,
    const core::SnapshotMetadata& metadata) const {
  std::lock_guard lock(mutex_);
  const auto loaded_at =
      metadata.loaded ? nlohmann::json(to_iso_string(metadata.loaded_at)) : nlohmann::json(nullptr);
  const auto snapshot_age_secs = metadata.loaded
      ? static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::seconds>(
                                        std::chrono::system_clock::now() - metadata.loaded_at)
                                        .count())
      : 0;
  return nlohmann::json{
      {"runtime",
       {
           {"bindHost", config.bind_host},
           {"bindPort", config.bind_port},
           {"backendSnapshotUrl", config.backend_snapshot_url},
           {"snapshotRefreshSecs", config.snapshot_refresh_secs},
           {"snapshotPageSize", config.snapshot_page_size},
           {"minEdgeScore", config.min_edge_score},
           {"maxNeighborsPerUser", config.max_neighbors_per_user},
           {"maxBranchingFactor", config.max_branching_factor},
           {"defaultNeighborLimit", config.default_neighbor_limit},
           {"defaultAuthorLimit", config.default_author_limit},
           {"defaultOverlapLimit", config.default_overlap_limit},
           {"defaultMaxDepth", config.default_max_depth},
       }},
      {"snapshot",
       {
           {"loaded", metadata.loaded},
           {"edgeCount", metadata.edge_count},
           {"vertexCount", metadata.vertex_count},
           {"snapshotVersion", metadata.snapshot_version},
           {"loadedAt", loaded_at},
           {"snapshotAgeSecs", snapshot_age_secs},
           {"edgeKinds", edge_kind_counts_json(metadata.edge_kind_counts)},
       }},
      {"requests",
       nlohmann::json{
           {"total", total_requests_},
           {"byKind", query_counts_json(query_stats_)},
           {"kernelQueryCounts", kernel_query_counts_json(query_stats_)},
           {"kernelLatency", kernel_latency_json(query_stats_)},
           {"kernelBudget", kernel_budget_json(query_stats_)},
           {"emptyReasonCounts", empty_reason_counts_json(query_stats_)},
           {"sourceEmptyRate", source_empty_rate_json(query_stats_)},
       }},
      {"refresh",
       {
           {"successes", refresh_successes_},
           {"failures", refresh_failures_},
           {"lastCompletedAt", last_refresh_completed_at_.value_or("")},
           {"lastDurationMs", last_refresh_duration_ms_.value_or(0)},
           {"lastError", last_error_.value_or("")},
       }},
  };
}

nlohmann::json GraphServiceMetrics::summary_payload(
    const config::ServiceConfig&,
    const core::SnapshotMetadata& metadata) const {
  std::lock_guard lock(mutex_);
  const auto status = status_for(metadata, refresh_failures_);
  const auto current_blocker = !metadata.loaded
      ? (last_error_.has_value() ? last_error_.value() : "snapshot_not_loaded")
      : (last_error_.has_value() ? last_error_.value() : "");
  const auto snapshot_age_secs = metadata.loaded
      ? static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::seconds>(
                                        std::chrono::system_clock::now() - metadata.loaded_at)
                                        .count())
      : 0;

  return nlohmann::json{
      {"status", status},
      {"currentStage", metadata.loaded ? "snapshot_primary" : "bootstrap"},
      {"currentBlocker", current_blocker},
      {"recommendedAction", metadata.loaded ? (last_error_.has_value() ? "investigate_refresh" : "monitor") : "load_snapshot"},
      {"snapshotLoaded", metadata.loaded},
      {"edgeCount", metadata.edge_count},
      {"vertexCount", metadata.vertex_count},
      {"snapshotVersion", metadata.snapshot_version},
      {"snapshotAgeSecs", snapshot_age_secs},
      {"edgeKinds", edge_kind_counts_json(metadata.edge_kind_counts)},
      {"kernelQueryCounts", kernel_query_counts_json(query_stats_)},
      {"kernelLatency", kernel_latency_json(query_stats_)},
      {"kernelBudget", kernel_budget_json(query_stats_)},
      {"emptyReasonCounts", empty_reason_counts_json(query_stats_)},
      {"sourceEmptyRate", source_empty_rate_json(query_stats_)},
      {"totalRequests", total_requests_},
  };
}

std::string GraphServiceMetrics::to_iso_string(std::chrono::system_clock::time_point value) {
  const auto time = std::chrono::system_clock::to_time_t(value);
  std::tm utc_time{};
#if defined(_WIN32)
  gmtime_s(&utc_time, &time);
#else
  gmtime_r(&time, &utc_time);
#endif
  std::ostringstream stream;
  stream << std::put_time(&utc_time, "%Y-%m-%dT%H:%M:%SZ");
  return stream.str();
}

}  // namespace telegram::graph::ops
