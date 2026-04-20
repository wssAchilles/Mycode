#include <algorithm>
#include <chrono>
#include <iostream>
#include <thread>
#include <unordered_set>
#include <vector>

#include <nlohmann/json.hpp>

#include "config/config.h"
#include "contracts/types.h"
#include "graph/graph_store.h"
#include "http/http_server.h"
#include "ops/metrics.h"
#include "snapshot/backend_snapshot_client.h"
#include "snapshot/snapshot_loader.h"

namespace tg_config = telegram::graph::config;
namespace tg_contracts = telegram::graph::contracts;
namespace tg_core = telegram::graph::core;
namespace tg_http = telegram::graph::http;
namespace tg_ops = telegram::graph::ops;
namespace tg_snapshot = telegram::graph::snapshot;

namespace {

std::unordered_set<std::string> read_excluded_ids(const nlohmann::json& body, const char* key) {
  std::unordered_set<std::string> excluded_ids;
  if (!body.contains(key) || !body.at(key).is_array()) {
    return excluded_ids;
  }

  for (const auto& value : body.at(key)) {
    excluded_ids.insert(value.get<std::string>());
  }
  return excluded_ids;
}

tg_http::HttpResponse json_response(const int status_code, const nlohmann::json& payload) {
  return tg_http::HttpResponse{
      .status_code = status_code,
      .body = payload.dump(),
  };
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

std::optional<std::string> default_empty_reason_for(const std::string& kernel, const std::size_t candidate_count) {
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
tg_http::HttpResponse candidate_response(
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
      .budget_exhausted = truncated_count > 0,
      .empty = query_result.candidates.empty(),
      .empty_reason = empty_reason,
      .relation_kinds = relation_kinds_for(query_result.candidates),
  };
  metrics.record_query(
      kernel,
      requested_limit,
      query_result.available_count,
      query_result.candidates.size(),
      duration,
      empty_reason);
  payload["candidates"] = query_result.candidates;
  payload["diagnostics"] = diagnostics;
  return json_response(200, tg_contracts::success_response(payload));
}

}  // namespace

int main() {
  try {
    const auto config = tg_config::load_from_env();
    tg_core::GraphStore store;
    tg_ops::GraphServiceMetrics metrics;
    tg_snapshot::SnapshotLoader loader(
        config,
        tg_snapshot::BackendSnapshotClient(
            config.backend_snapshot_url,
            config.internal_token,
            config.backend_timeout_ms),
        store,
        metrics);

    try {
      loader.refresh_once();
      std::cout << "[graph-kernel] bootstrap snapshot loaded" << std::endl;
    } catch (const std::exception& error) {
      std::cerr << "[graph-kernel] bootstrap snapshot failed: " << error.what() << std::endl;
    }

    std::thread refresh_thread([&loader, &config]() {
      while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(config.snapshot_refresh_secs));
        try {
          loader.refresh_once();
          std::cout << "[graph-kernel] snapshot refreshed" << std::endl;
        } catch (const std::exception& error) {
          std::cerr << "[graph-kernel] snapshot refresh failed: " << error.what() << std::endl;
        }
      }
    });
    refresh_thread.detach();

    tg_http::HttpServer server(
        config.bind_host,
        config.bind_port,
        [&](const tg_http::HttpRequest& request) -> tg_http::HttpResponse {
          if (request.method == "GET" && request.path == "/health") {
            const auto metadata = store.metadata();
            return json_response(
                200,
                tg_contracts::success_response(nlohmann::json{
                    {"ok", true},
                    {"service", "cpp_graph_kernel"},
                    {"snapshotLoaded", metadata.loaded},
                    {"edgeCount", metadata.edge_count},
                }));
          }

          if (request.method == "GET" && request.path == "/ops/graph") {
            return json_response(
                200,
                tg_contracts::success_response(metrics.ops_payload(config, store.metadata())));
          }

          if (request.method == "GET" && request.path == "/ops/graph/summary") {
            return json_response(
                200,
                tg_contracts::success_response(metrics.summary_payload(config, store.metadata())));
          }

          const auto metadata = store.metadata();
          if (!metadata.loaded) {
            return json_response(
                503,
                tg_contracts::error_response(
                    tg_contracts::ErrorPayload{
                        .code = "SNAPSHOT_UNAVAILABLE",
                        .message = "graph snapshot not loaded",
                    }));
          }

          if (request.method != "POST") {
            return json_response(
                405,
                tg_contracts::error_response(
                    tg_contracts::ErrorPayload{
                        .code = "METHOD_NOT_ALLOWED",
                        .message = "only GET health/ops and POST graph queries are supported",
                    }));
          }

          const auto body = request.body.empty() ? nlohmann::json::object() : nlohmann::json::parse(request.body);
          if (request.path == "/graph/neighbors") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_neighbor_limit);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.direct_neighbors(user_id, limit, excluded_ids);
            return candidate_response(
                "neighbors",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/social-neighbors") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_neighbor_limit);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.social_neighbors(user_id, limit, excluded_ids);
            return candidate_response(
                "social_neighbors",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/recent-engagers") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_neighbor_limit);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.recent_engagers(user_id, limit, excluded_ids);
            return candidate_response(
                "recent_engagers",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/co-engagers") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_neighbor_limit);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.co_engagers(user_id, limit, excluded_ids);
            return candidate_response(
                "co_engagers",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/content-affinity-neighbors") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_neighbor_limit);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.content_affinity_neighbors(user_id, limit, excluded_ids);
            return candidate_response(
                "content_affinity_neighbors",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/multi-hop") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_author_limit);
            const auto max_depth = body.value("maxDepth", config.default_max_depth);
            const auto exclude_direct = body.value("excludeDirectNeighbors", true);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.multi_hop_candidates(
                user_id,
                limit,
                max_depth,
                config.max_branching_factor,
                excluded_ids,
                exclude_direct);
            return candidate_response(
                "multi_hop",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/bridge-users") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_author_limit);
            const auto max_depth = body.value("maxDepth", config.default_max_depth);
            const auto exclude_direct = body.value("excludeDirectNeighbors", true);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.bridge_users(
                user_id,
                limit,
                max_depth,
                config.max_branching_factor,
                excluded_ids,
                exclude_direct);
            return candidate_response(
                "bridge_users",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/author-candidates") {
            const auto user_id = body.at("userId").get<std::string>();
            auto excluded_ids = read_excluded_ids(body, "excludeUserIds");
            excluded_ids.insert(user_id);
            const auto limit = body.value("limit", config.default_author_limit);
            const auto max_depth = body.value("maxDepth", config.default_max_depth);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.multi_hop_candidates(
                user_id,
                limit,
                max_depth,
                config.max_branching_factor,
                excluded_ids,
                true);
            return candidate_response(
                "author_candidates",
                nlohmann::json{{"userId", user_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          if (request.path == "/graph/overlap") {
            const auto user_a_id = body.at("userAId").get<std::string>();
            const auto user_b_id = body.at("userBId").get<std::string>();
            const auto limit = body.value("limit", config.default_overlap_limit);
            const auto started_at = std::chrono::steady_clock::now();
            const auto candidates = store.overlap_candidates(user_a_id, user_b_id, limit);
            return candidate_response(
                "overlap",
                nlohmann::json{{"userAId", user_a_id}, {"userBId", user_b_id}},
                candidates,
                limit,
                metrics,
                started_at);
          }

          return json_response(
              404,
              tg_contracts::error_response(
                  tg_contracts::ErrorPayload{
                      .code = "NOT_FOUND",
                      .message = "unknown route",
                  }));
        });

    std::cout << "[graph-kernel] listening on " << config.bind_host << ':' << config.bind_port << std::endl;
    server.serve_forever();
  } catch (const std::exception& error) {
    std::cerr << "[graph-kernel] fatal: " << error.what() << std::endl;
    return 1;
  }

  return 0;
}
