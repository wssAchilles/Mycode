#include "http/routes/graph_routes.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/sha.h>

#include "contracts/types.h"
#include "graph/realtime/delta_edge_overlay.h"
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

// 大小写不敏感提取请求头，兼容 HTTP 解析器与单元测试直传结构
std::string read_header_case_insensitive(
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& lower_key) {
  if (const auto direct = headers.find(lower_key); direct != headers.end()) {
    return direct->second;
  }
  for (const auto& [key, value] : headers) {
    if (key.size() != lower_key.size()) {
      continue;
    }
    bool matched = true;
    for (std::size_t idx = 0; idx < key.size(); ++idx) {
      if (static_cast<char>(std::tolower(static_cast<unsigned char>(key[idx]))) != lower_key[idx]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return value;
    }
  }
  return "";
}

// 基于 SHA-256 定长摘要与 CRYPTO_memcmp 实现恒定时间密钥比对，避免长度与时序侧信道泄漏
bool constant_time_token_equals(const std::string& provided, const std::string& expected) {
  unsigned char provided_digest[SHA256_DIGEST_LENGTH];
  unsigned char expected_digest[SHA256_DIGEST_LENGTH];
  SHA256(
      reinterpret_cast<const unsigned char*>(provided.data()),
      provided.size(),
      provided_digest);
  SHA256(
      reinterpret_cast<const unsigned char*>(expected.data()),
      expected.size(),
      expected_digest);
  return CRYPTO_memcmp(provided_digest, expected_digest, SHA256_DIGEST_LENGTH) == 0;
}

std::optional<HttpResponse> verify_internal_token(
    const HttpRequest& request,
    const tg_config::ServiceConfig& config) {
  if (config.internal_token.empty()) {
    return std::nullopt;
  }
  const auto incoming =
      read_header_case_insensitive(request.headers, "x-graph-kernel-internal-token");
  if (incoming.empty()) {
    return error_response(
        401,
        "UNAUTHORIZED",
        "missing x-graph-kernel-internal-token header");
  }
  if (!constant_time_token_equals(incoming, config.internal_token)) {
    return error_response(
        403,
        "FORBIDDEN",
        "invalid x-graph-kernel-internal-token header");
  }
  return std::nullopt;
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
nlohmann::json candidate_payload(
    const std::string& kernel,
    nlohmann::json payload,
    const tg_core::GraphStore::QueryCandidates<Candidate>& query_result,
    const std::size_t requested_limit,
    tg_ops::GraphServiceMetrics& metrics,
    const std::chrono::milliseconds duration) {
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
      .scanned_count = query_result.scanned_count,
      .visited_count = query_result.visited_count,
      .snapshot_version = query_result.snapshot_version,
      .snapshot_loaded_at = query_result.snapshot_loaded_at,
      .pruned_count = query_result.pruned_count,
      .frontier_max_size = query_result.frontier_max_size,
      .budget_exhausted = query_result.budget_exhausted,
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
  return payload;
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
  return json_response(
      200,
      tg_contracts::success_response(candidate_payload(
          kernel,
          std::move(payload),
          query_result,
          requested_limit,
          metrics,
          duration)));
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

std::size_t read_required_batch_size(
    const nlohmann::json& body,
    const char* key,
    const std::size_t max_value) {
  if (!body.contains(key) || body.at(key).is_null()) {
    throw RequestValidationError(std::string("missing required integer field: ") + key);
  }
  return read_optional_size(body, key, 0, max_value);
}

tg_core::GraphBatchQuery parse_batch_query(
    const nlohmann::json& body,
    const tg_config::ServiceConfig& config) {
  auto query = tg_core::GraphBatchQuery{
      .user_id = read_required_string(body, "userId"),
      .direct_limit =
          read_required_batch_size(body, "directLimit", config.max_query_limit),
      .bridge_limit =
          read_required_batch_size(body, "bridgeLimit", config.max_query_limit),
      .max_depth = read_required_batch_size(body, "maxDepth", config.max_query_depth),
      .max_branching_factor = config.max_branching_factor,
      .max_visited_nodes = config.max_multi_hop_visited,
      .max_candidates = config.max_multi_hop_candidates,
      .excluded_user_ids = read_optional_string_set(body, "excludeUserIds"),
  };
  if (query.max_depth == 0) {
    throw RequestValidationError("maxDepth must be at least 1");
  }
  query.excluded_user_ids.insert(query.user_id);
  return query;
}

HttpResponse handle_batch_query(
    const nlohmann::json& body,
    tg_core::GraphStore& store,
    const tg_config::ServiceConfig& config,
    tg_ops::GraphServiceMetrics& metrics) {
  const auto query = parse_batch_query(body, config);
  const auto batch = store.batch(query);
  if (!batch.has_value()) {
    return error_response(503, "SNAPSHOT_UNAVAILABLE", "graph snapshot not loaded");
  }

  const auto loaded_at_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
      batch->snapshot_loaded_at.time_since_epoch()).count();
  auto payload = nlohmann::json{
      {"userId", query.user_id},
      {"snapshotVersion", batch->snapshot_version},
      {"snapshotLoadedAtMs", loaded_at_ms},
  };
  payload["socialNeighbors"] = candidate_payload(
      "social_neighbors", nlohmann::json::object(), batch->social_neighbors,
      query.direct_limit, metrics, batch->durations.social_neighbors);
  payload["recentEngagers"] = candidate_payload(
      "recent_engagers", nlohmann::json::object(), batch->recent_engagers,
      query.direct_limit, metrics, batch->durations.recent_engagers);
  payload["bridgeUsers"] = candidate_payload(
      "bridge_users", nlohmann::json::object(), batch->bridge_users,
      query.bridge_limit, metrics, batch->durations.bridge_users);
  payload["coEngagers"] = candidate_payload(
      "co_engagers", nlohmann::json::object(), batch->co_engagers,
      query.direct_limit, metrics, batch->durations.co_engagers);
  payload["contentAffinityNeighbors"] = candidate_payload(
      "content_affinity_neighbors", nlohmann::json::object(),
      batch->content_affinity_neighbors, query.direct_limit, metrics,
      batch->durations.content_affinity_neighbors);
  return json_response(200, tg_contracts::success_response(payload));
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
  if (request.path != "/graph/batch" && request.path != "/graph/delta" &&
      request.path != "/graph/author-cred") {
    const auto metadata = store.metadata();
    if (!metadata.loaded) {
      return error_response(503, "SNAPSHOT_UNAVAILABLE", "graph snapshot not loaded");
    }
  }

  nlohmann::json body;
  try {
    body = request.body.empty() ? nlohmann::json::object() : nlohmann::json::parse(request.body);
  } catch (const nlohmann::json::parse_error&) {
    return error_response(400, "INVALID_JSON", "malformed request body");
  }

  try {
    if (request.path == "/graph/delta") {
      const auto source = body.value("sourceUserId", "");
      const auto target = body.value("targetUserId", "");
      const auto op = tg_core::realtime::parse_delta_edge_op(body.value("edgeOp", ""));
      if (source.empty() || target.empty() || !op.has_value()) {
        return invalid_request_response("sourceUserId, targetUserId, and valid edgeOp are required");
      }
      store.apply_edge_delta(tg_core::realtime::EdgeDeltaEvent{
          .source_user_id = source,
          .target_user_id = target,
          .op = *op,
          .weight_delta = body.value("weightDelta", 0.0),
          .timestamp_ms = body.value("timestampMs", static_cast<std::int64_t>(0)),
      });
      const auto snap = store.delta_overlay()->metrics();
      return json_response(
          200,
          tg_contracts::success_response(nlohmann::json{
              {"applied", true},
              {"appliedEvents", snap.applied_events},
              {"blockedPairCount", snap.blocked_pair_count},
              {"lastEventLagMs", snap.last_event_lag_ms},
          }));
    }
    if (request.path == "/graph/author-cred") {
      if (!body.contains("authorIds") || !body.at("authorIds").is_array()) {
        return invalid_request_response("authorIds array is required");
      }
      std::vector<std::string> author_ids;
      for (const auto& item : body.at("authorIds")) {
        if (item.is_string() && !item.get<std::string>().empty()) {
          author_ids.push_back(item.get<std::string>());
        }
      }
      const auto results = store.author_cred_scores(author_ids);
      nlohmann::json scores = nlohmann::json::array();
      scores.get_ref<nlohmann::json::array_t&>().reserve(results.size());
      std::transform(
          results.begin(),
          results.end(),
          std::back_inserter(scores.get_ref<nlohmann::json::array_t&>()),
          [](const auto& r) {
            return nlohmann::json{
                {"authorId", r.author_id},
                {"authorCredScore", r.author_cred_score},
                {"inDegree", r.in_degree},
                {"totalInWeight", r.total_in_weight},
                {"negativePenalty", r.negative_penalty},
            };
          });
      return json_response(200, tg_contracts::success_response(nlohmann::json{{"scores", scores}}));
    }
    if (request.path == "/graph/batch") {
      return handle_batch_query(body, store, config, metrics);
    }
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
    // 容器存活探针免内部鉴权，其余所有 /graph/*、/ops/*、/metrics 与 /ready 均强制恒定时间验签
    if (request.method == "GET" && request.path == "/health") {
      return json_response(
          200,
          tg_contracts::success_response(nlohmann::json{
              {"ok", true},
              {"service", "cpp_graph_kernel"},
          }));
    }

    if (auto auth_error = verify_internal_token(request, config); auth_error.has_value()) {
      return std::move(auth_error.value());
    }

    if (request.method == "GET") {
      // 就绪探针：校验快照是否已加载并可服务查询
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
        auto payload = metrics.ops_payload(config, store.metadata());
        if (const auto overlay = store.delta_overlay()) {
          const auto snap = overlay->metrics();
          payload["deltaOverlay"] = {
              {"appliedEvents", snap.applied_events},
              {"parseErrors", snap.parse_errors},
              {"blockedPairCount", snap.blocked_pair_count},
              {"boostedPairCount", snap.boosted_pair_count},
              {"lastEventLagMs", snap.last_event_lag_ms},
          };
        }
        return json_response(200, tg_contracts::success_response(payload));
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
