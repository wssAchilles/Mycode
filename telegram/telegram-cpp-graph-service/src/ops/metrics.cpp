#include "ops/metrics.h"

#include <iomanip>
#include <sstream>

#include "ops/summaries/http_runtime_summary.h"
#include "ops/summaries/kernel_summary.h"
#include "ops/summaries/snapshot_summary.h"

namespace telegram::graph::ops {
namespace {

constexpr std::size_t kLatencySampleCapacity = 128;

std::string status_for(const core::SnapshotMetadata& metadata, std::uint64_t refresh_failures) {
  if (!metadata.loaded) {
    return refresh_failures == 0 ? "bootstrap" : "degraded";
  }
  return refresh_failures > 0 ? "degraded" : "healthy";
}

}  // namespace

void GraphServiceMetrics::record_query(
    const std::string& kind,
    const std::size_t requested_limit,
    const std::size_t available_count,
    const std::size_t result_count,
    const std::size_t scanned_count,
    const std::size_t visited_count,
    const bool budget_exhausted,
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
  stats.last_scanned_count = scanned_count;
  stats.last_visited_count = visited_count;
  if (budget_exhausted) {
    stats.budget_exhausted_count += 1;
  }
  if (stats.last_truncated_count > 0) {
    stats.truncated_request_count += 1;
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

void GraphServiceMetrics::attach_http_runtime_metrics(std::shared_ptr<http::HttpRuntimeMetrics> metrics) {
  std::lock_guard lock(mutex_);
  http_runtime_metrics_ = std::move(metrics);
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
           {"maxQueryLimit", config.max_query_limit},
           {"maxQueryDepth", config.max_query_depth},
           {"maxMultiHopVisited", config.max_multi_hop_visited},
           {"maxMultiHopCandidates", config.max_multi_hop_candidates},
           {"httpMaxConnections", config.http_max_connections},
           {"httpWorkerCount", config.http_worker_count},
           {"httpQueueCapacity", config.http_queue_capacity},
           {"httpRequestTimeoutSecs", config.http_request_timeout_secs},
           {"httpMaxBodyBytes", config.http_max_body_bytes},
       }},
      {"httpRuntime", summaries::http_runtime_json(config, http_runtime_metrics_)},
      {"snapshot", summaries::snapshot_payload_json(metadata, loaded_at, snapshot_age_secs)},
      {"requests",
       nlohmann::json{
           {"total", total_requests_},
           {"byKind", summaries::query_counts_json(query_stats_)},
           {"kernelQueryCounts", summaries::kernel_query_counts_json(query_stats_)},
           {"kernelLatency", summaries::kernel_latency_json(query_stats_)},
           {"kernelBudget", summaries::kernel_budget_json(query_stats_)},
           {"kernelRouteSummary", summaries::kernel_route_summary_json(query_stats_)},
           {"routeSummary", summaries::route_summary_json(query_stats_)},
           {"emptyReasonCounts", summaries::empty_reason_counts_json(query_stats_)},
           {"sourceEmptyRate", summaries::source_empty_rate_json(query_stats_)},
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
    const config::ServiceConfig& config,
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

  auto payload = nlohmann::json{
      {"status", status},
      {"currentStage", metadata.loaded ? "snapshot_primary" : "bootstrap"},
      {"currentBlocker", current_blocker},
      {"recommendedAction", metadata.loaded ? (last_error_.has_value() ? "investigate_refresh" : "monitor") : "load_snapshot"},
      {"kernelQueryCounts", summaries::kernel_query_counts_json(query_stats_)},
      {"kernelLatency", summaries::kernel_latency_json(query_stats_)},
      {"kernelBudget", summaries::kernel_budget_json(query_stats_)},
      {"kernelRouteSummary", summaries::kernel_route_summary_json(query_stats_)},
      {"routeSummary", summaries::route_summary_json(query_stats_)},
      {"emptyReasonCounts", summaries::empty_reason_counts_json(query_stats_)},
      {"sourceEmptyRate", summaries::source_empty_rate_json(query_stats_)},
      {"totalRequests", total_requests_},
      {"httpRuntime", summaries::http_runtime_json(config, http_runtime_metrics_)},
  };
  payload.update(summaries::snapshot_summary_fields_json(metadata, snapshot_age_secs));
  return payload;
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
