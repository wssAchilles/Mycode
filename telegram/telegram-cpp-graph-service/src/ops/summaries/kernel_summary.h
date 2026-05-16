#pragma once

#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include "ops/metrics.h"

namespace telegram::graph::ops::summaries {

nlohmann::json query_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json kernel_query_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json kernel_latency_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json kernel_budget_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json kernel_route_summary_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json route_summary_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json empty_reason_counts_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

nlohmann::json source_empty_rate_json(
    const std::unordered_map<std::string, GraphServiceMetrics::QueryStats>& query_stats);

}  // namespace telegram::graph::ops::summaries
