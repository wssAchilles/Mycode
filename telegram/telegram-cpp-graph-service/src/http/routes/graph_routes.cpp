#include "http/routes/graph_routes.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <optional>
#include <unordered_set>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "contracts/types.h"
#include "telemetry/metrics.h"
#include "http/routes/request_validation.h"

namespace telegram::graph::http {
namespace {

namespace tg_config = telegram::graph::config;
namespace tg_contracts = telegram::graph::contracts;
namespace tg_core = telegram::graph::core;
namespace tg_ops = telegram::graph::ops;

HttpResponse json_response(const int status_code, const nlohmann::json& payload) {
  return HttpResponse{
      .status_code = status_code,
      .body = payload.dump(),
  };
}

HttpResponse error_response(const int status_code, std::string code, std::string message) {
  return json_response(
      status_code,
      tg_contracts::error_response(tg_contracts::ErrorPayload{
          .code = std::move(code),
          .message = std::move(message),
      }));
}

HttpResponse invalid_request_response(const std::string& message) {
  return error_response(400, "INVALID_REQUEST", message);
}

std::vector<std::string> sort_and_dedup(std::unordered_set<std::string> values) {
  auto sorted = std::vector<std::string>(values.begin(), values.end());
  std::sort(sorted.begin(), sorted.end());
  return sorted;
}

std::vector<std::string> relation_kinds_for(
    const std::vector<tg_contracts::NeighborCandidate>& candidates) {
  std::unordered_set<std::string> relation_kinds;
  for (const auto& candidate : candidates) {
    for (const auto& relation_kind : candidate.relation_kinds) {
      if (!relation_kind.empty()) {
        relation_kinds.insert(relation_kind);
      }
    }
  }
  return sort_and_dedup(std::move(relation_kinds));
}

template <typename Candidate>
std::vector<std::string> relation_kinds_for(const std::vector<Candidate>&) {
  return {};
}

std::optional<std::string> default_empty_reason_for(
    const std::string& kernel,
    const std::size_t candidate_count) {
  if (candidate_count > 0) {
    return std::nullopt;
  }

  if (kernel == "neighbors") return "no_neighbors";
  if (kernel == "social_neighbors") return "no_social_neighbors";
  if (kernel == "recent_engagers") return "no_recent_engagers";
  if (kernel == "co_engagers") return "no_co_engagers";
  if (kernel == "content_affinity_neighbors") return "no_content_affinity_neighbors";
  if (kernel == "bridge_users") return "no_bridge_users";
  if (kernel == "multi_hop") return "no_multi_hop_candidates";
  if (kernel == "author_candidates") return "no_author_candidates";
  if (kernel == "overlap") return "no_overlap_candidates";
  return "no_candidates";
}

template <typename Candidate>
HttpResponse candidate_response(
    const std::string& kernel,
    nlohmann::json payload,
    const tg_core::GraphStore::QueryCandidates<Candidate>& query_result,
    const std::size_t requested_limit,
    tg_ops::GraphServiceMetrics& metrics,
    const std::chrono::steady_clock::time_point started_at) {
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at);
  const auto truncated_count =
      query_result.available_count > query_result.candidates.size()
          ? query_result.available_count - query_result.candidates.size()
          : 0;
  const auto empty_reason = default_empty_reason_for(kernel, query_result.candidates.size());
  const auto diagnostics = tg_contracts::GraphQueryDiagnostics{
      .kernel = kernel,
      .query_duration_ms = static_cast<std::uint64_t>(duration.count()),
      .candidate_count = query_result.candidates.size(),
      .requested_limit = requested_limit,
      .available_count = query_result.available_count,
      .truncated_count = truncated_count,
      .snapshot_version = query_result.snapshot_version,
      .snapshot_loaded_at = query_result.snapshot_loaded_at,
      .pruned_count = query_result.pruned_count,
      .frontier_max_size = query_result.frontier_max_size,
      .budget_exhausted = query_result.budget_exhausted || truncated_count > 0,
      .empty = query_result.candidates.empty(),
      .empty_reason = empty_reason,
      .relation_kinds = relation_kinds_for(query_result.candidates),
  };
  metrics.record_query(
      kernel,
      requested_limit,
      query_result.available_count,
      query_result.candidates.size(),
      query_result.scanned_count,
      query_result.visited_count,
      query_result.budget_exhausted,
      duration,
      empty_reason);
  payload["candidates"] = query_result.candidates;
  payload["diagnostics"] = diagnostics;
  return json_response(200, tg_contracts::success_response(payload));
}

tg_core::NeighborQuery parse_neighbor_query(
    const nlohmann::json& body,
    const std::size_t default_limit,
    const std::size_t max_query_limit) {
  auto query = tg_core::NeighborQuery{
      .user_id = read_required_string(body, "userId"),
      .limit = read_optional_size(body, "limit", default_limit, max_query_limit),
      .excluded_user_ids = read_optional_string_set(body, "excludeUserIds"),
  };
  query.excluded_user_ids.insert(query.user_id);
  return query;
}

tg_core::TraversalQuery parse_traversal_query(
    const nlohmann::json& body,
    const tg_config::ServiceConfig& config,
    const bool force_exclude_direct) {
  auto query = tg_core::TraversalQuery{
      .user_id = read_required_string(body, "userId"),
      .limit = read_optional_size(body, "limit", config.default_author_limit, config.max_query_limit),
      .max_depth = read_optional_size(body, "maxDepth", config.default_max_depth, config.max_query_depth),
      .max_branching_factor = config.max_branching_factor,
      .max_visited_nodes = config.max_multi_hop_visited,
      .max_candidates = config.max_multi_hop_candidates,
      .excluded_user_ids = read_optional_string_set(body, "excludeUserIds"),
      .exclude_direct_neighbors =
          force_exclude_direct || read_optional_bool(body, "excludeDirectNeighbors", true),
  };
  if (query.max_depth == 0) {
    throw RequestValidationError("maxDepth must be at least 1");
  }
  query.excluded_user_ids.insert(query.user_id);
  return query;
}

tg_core::OverlapQuery parse_overlap_query(
    const nlohmann::json& body,
    const tg_config::ServiceConfig& config) {
  return tg_core::OverlapQuery{
      .user_a_id = read_required_string(body, "userAId"),
      .user_b_id = read_required_string(body, "userBId"),
      .limit = read_optional_size(body, "limit", config.default_overlap_limit, config.max_query_limit),
  };
}

using NeighborStoreMethod = tg_core::GraphStore::QueryCandidates<tg_contracts::NeighborCandidate> (
    tg_core::GraphStore::*)(const tg_core::NeighborQuery&) const;
template <typename Candidate>
using TraversalStoreMethod = tg_core::GraphStore::QueryCandidates<Candidate> (
    tg_core::GraphStore::*)(const tg_core::TraversalQuery&) const;

HttpResponse handle_neighbor_query(
    const nlohmann::json& body,
    const std::string& kernel,
    NeighborStoreMethod store_method,
    tg_core::GraphStore& store,
    const std::size_t default_limit,
    const std::size_t max_query_limit,
    tg_ops::GraphServiceMetrics& metrics) {
  const auto query = parse_neighbor_query(body, default_limit, max_query_limit);
  const auto started_at = std::chrono::steady_clock::now();
  const auto candidates = (store.*store_method)(query);
  return candidate_response(
      kernel,
      nlohmann::json{{"userId", query.user_id}},
      candidates,
      query.limit,
      metrics,
      started_at);
}

template <typename Candidate>
HttpResponse handle_multi_hop_query(
    const nlohmann::json& body,
    const std::string& kernel,
    TraversalStoreMethod<Candidate> store_method,
    tg_core::GraphStore& store,
    const tg_config::ServiceConfig& config,
    tg_ops::GraphServiceMetrics& metrics,
    bool force_exclude_direct = false) {
  const auto query = parse_traversal_query(body, config, force_exclude_direct);
  const auto started_at = std::chrono::steady_clock::now();
  const auto candidates = (store.*store_method)(query);
  return candidate_response(
      kernel,
      nlohmann::json{{"userId", query.user_id}},
      candidates,
      query.limit,
      metrics,
      started_at);
}

HttpResponse handle_graph_post(
    const HttpRequest& request,
    const tg_config::ServiceConfig& config,
    tg_core::GraphStore& store,
    tg_ops::GraphServiceMetrics& metrics) {
  const auto metadata = store.metadata();
  if (!metadata.loaded) {
    return error_response(503, "SNAPSHOT_UNAVAILABLE", "graph snapshot not loaded");
  }

  nlohmann::json body;
  try {
    body = request.body.empty() ? nlohmann::json::object() : nlohmann::json::parse(request.body);
  } catch (const nlohmann::json::parse_error&) {
    return error_response(400, "INVALID_JSON", "malformed request body");
  }

  try {
    if (request.path == "/graph/neighbors") {
      return handle_neighbor_query(body, "neighbors", &tg_core::GraphStore::direct_neighbors,
          store, config.default_neighbor_limit, config.max_query_limit, metrics);
    }
    if (request.path == "/graph/social-neighbors") {
      return handle_neighbor_query(body, "social_neighbors", &tg_core::GraphStore::social_neighbors,
          store, config.default_neighbor_limit, config.max_query_limit, metrics);
    }
    if (request.path == "/graph/recent-engagers") {
      return handle_neighbor_query(body, "recent_engagers", &tg_core::GraphStore::recent_engagers,
          store, config.default_neighbor_limit, config.max_query_limit, metrics);
    }
    if (request.path == "/graph/co-engagers") {
      return handle_neighbor_query(body, "co_engagers", &tg_core::GraphStore::co_engagers,
          store, config.default_neighbor_limit, config.max_query_limit, metrics);
    }
    if (request.path == "/graph/content-affinity-neighbors") {
      return handle_neighbor_query(body, "content_affinity_neighbors",
          &tg_core::GraphStore::content_affinity_neighbors,
          store, config.default_neighbor_limit, config.max_query_limit, metrics);
    }
    if (request.path == "/graph/multi-hop") {
      return handle_multi_hop_query(body, "multi_hop", &tg_core::GraphStore::multi_hop_candidates,
          store, config, metrics);
    }
    if (request.path == "/graph/bridge-users") {
      return handle_multi_hop_query(body, "bridge_users", &tg_core::GraphStore::bridge_users,
          store, config, metrics);
    }
    if (request.path == "/graph/author-candidates") {
      return handle_multi_hop_query(body, "author_candidates", &tg_core::GraphStore::multi_hop_candidates,
          store, config, metrics, /*force_exclude_direct=*/true);
    }
    if (request.path == "/graph/overlap") {
      const auto query = parse_overlap_query(body, config);
      const auto started_at = std::chrono::steady_clock::now();
      const auto candidates = store.overlap_candidates(query);
      return candidate_response(
          "overlap",
          nlohmann::json{{"userAId", query.user_a_id}, {"userBId", query.user_b_id}},
          candidates,
          query.limit,
          metrics,
          started_at);
    }
  } catch (const RequestValidationError& error) {
    return invalid_request_response(error.what());
  }

  return error_response(404, "NOT_FOUND", "unknown route");
}

}  // namespace

HttpServer::Handler make_graph_handler(
    const config::ServiceConfig& config,
    core::GraphStore& store,
    ops::GraphServiceMetrics& metrics) {
  return [&config, &store, &metrics](const HttpRequest& request) -> HttpResponse {
    if (request.method == "GET") {
      // Liveness probe — always returns 200 (unless process is crashing)
      if (request.path == "/health") {
        return json_response(
            200,
            tg_contracts::success_response(nlohmann::json{
                {"ok", true},
                {"service", "cpp_graph_kernel"},
            }));
      }
      // Readiness probe — checks if snapshot is loaded and service can handle requests
      if (request.path == "/ready") {
        const auto metadata = store.metadata();
        const auto status_code = metadata.loaded ? 200 : 503;
        return json_response(
            status_code,
            tg_contracts::success_response(nlohmann::json{
                {"ready", metadata.loaded},
                {"service", "cpp_graph_kernel"},
                {"snapshotLoaded", metadata.loaded},
                {"edgeCount", metadata.edge_count},
            }));
      }
      if (request.path == "/ops/graph") {
        return json_response(
            200,
            tg_contracts::success_response(metrics.ops_payload(config, store.metadata())));
      }
      // Prometheus metrics endpoint
      if (request.path == "/metrics") {
        const auto metrics_text = telegram::graph::telemetry::MetricsCollector::instance().to_prometheus();
        return HttpResponse{
            .status_code = 200,
            .content_type = "text/plain; version=0.0.4; charset=utf-8",
            .body = metrics_text,
        };
      }
      if (request.path == "/ops/graph/summary") {
        return json_response(
            200,
            tg_contracts::success_response(metrics.summary_payload(config, store.metadata())));
      }
      return error_response(404, "NOT_FOUND", "unknown route");
    }

    if (request.method != "POST") {
      return error_response(
          405,
          "METHOD_NOT_ALLOWED",
          "only GET health/ops and POST graph queries are supported");
    }
    return handle_graph_post(request, config, store, metrics);
  };
}

}  // namespace telegram::graph::http
