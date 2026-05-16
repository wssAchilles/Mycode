#include "ops/summaries/kernel_summary.h"

#include <algorithm>
#include <deque>
#include <vector>

namespace telegram::graph::ops::summaries {
namespace {

const std::vector<std::string>& graph_kernel_kinds() {
  static const std::vector<std::string> kinds{
      "social_neighbors",
      "recent_engagers",
      "co_engagers",
      "content_affinity_neighbors",
      "bridge_users",
  };
  return kinds;
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

nlohmann::json empty_reason_counts_for(const GraphServiceMetrics::QueryStats& stats) {
  auto result = nlohmann::json::object();
  for (const auto& [reason, count] : stats.empty_reason_counts) {
    result[reason] = count;
  }
  return result;
}

nlohmann::json query_stats_summary_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats,
    const std::vector<std::string>& kinds) {
  auto result = nlohmann::json::object();
  for (const auto& kind : kinds) {
    const auto iterator = query_stats.find(kind);
    const auto stats =
        iterator == query_stats.end() ? GraphServiceMetrics::QueryStats{} : iterator->second;
    result[kind] = nlohmann::json{
        {"requestCount", stats.requests},
        {"emptyResults", stats.empty_results},
        {"emptyRate", stats.requests == 0
            ? 0.0
            : static_cast<double>(stats.empty_results) / static_cast<double>(stats.requests)},
        {"lastDurationMs", stats.last_duration_ms},
        {"p50Ms", percentile(stats.duration_samples, 50)},
        {"p95Ms", percentile(stats.duration_samples, 95)},
        {"p99Ms", percentile(stats.duration_samples, 99)},
        {"lastRequestedLimit", stats.last_requested_limit},
        {"lastAvailableCount", stats.last_available_count},
        {"lastReturnedCount", stats.last_returned_count},
        {"lastTruncatedCount", stats.last_truncated_count},
        {"lastScannedCount", stats.last_scanned_count},
        {"lastVisitedCount", stats.last_visited_count},
        {"budgetExhaustedCount", stats.budget_exhausted_count},
        {"truncatedRequestCount", stats.truncated_request_count},
        {"emptyReasonCounts", empty_reason_counts_for(stats)},
    };
  }
  return result;
}

}  // namespace

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
  for (const auto& kind : graph_kernel_kinds()) {
    const auto iterator = query_stats.find(kind);
    result[kind] = iterator == query_stats.end() ? 0 : iterator->second.requests;
  }
  return result;
}

nlohmann::json source_empty_rate_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind : graph_kernel_kinds()) {
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

nlohmann::json kernel_latency_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind : graph_kernel_kinds()) {
    const auto iterator = query_stats.find(kind);
    const auto stats =
        iterator == query_stats.end() ? GraphServiceMetrics::QueryStats{} : iterator->second;
    result[kind] = nlohmann::json{
        {"lastMs", stats.last_duration_ms},
        {"p50Ms", percentile(stats.duration_samples, 50)},
        {"p95Ms", percentile(stats.duration_samples, 95)},
        {"p99Ms", percentile(stats.duration_samples, 99)},
    };
  }
  return result;
}

nlohmann::json empty_reason_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind : graph_kernel_kinds()) {
    const auto iterator = query_stats.find(kind);
    result[kind] = iterator == query_stats.end()
        ? nlohmann::json::object()
        : empty_reason_counts_for(iterator->second);
  }
  return result;
}

nlohmann::json kernel_budget_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto result = nlohmann::json::object();
  for (const auto& kind : graph_kernel_kinds()) {
    const auto iterator = query_stats.find(kind);
    const auto stats =
        iterator == query_stats.end() ? GraphServiceMetrics::QueryStats{} : iterator->second;
    result[kind] = nlohmann::json{
        {"lastRequestedLimit", stats.last_requested_limit},
        {"lastAvailableCount", stats.last_available_count},
        {"lastReturnedCount", stats.last_returned_count},
        {"lastTruncatedCount", stats.last_truncated_count},
        {"lastScannedCount", stats.last_scanned_count},
        {"lastVisitedCount", stats.last_visited_count},
        {"budgetExhaustedCount", stats.budget_exhausted_count},
        {"truncatedRequestCount", stats.truncated_request_count},
    };
  }
  return result;
}

nlohmann::json kernel_route_summary_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  return query_stats_summary_json(query_stats, graph_kernel_kinds());
}

nlohmann::json route_summary_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats) {
  auto kinds = std::vector<std::string>{};
  kinds.reserve(query_stats.size());
  for (const auto& entry : query_stats) {
    kinds.push_back(entry.first);
  }
  std::sort(kinds.begin(), kinds.end());
  return query_stats_summary_json(query_stats, kinds);
}

}  // namespace telegram::graph::ops::summaries
