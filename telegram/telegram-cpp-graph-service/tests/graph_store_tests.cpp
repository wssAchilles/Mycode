#include <cassert>
#include <chrono>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

#include <nlohmann/json.hpp>

#include "config/config.h"
#include "contracts/types.h"
#include "graph/graph_store.h"
#include "http/graph_routes.h"
#include "http/request_validation.h"
#include "ops/metrics.h"

namespace {

using telegram::graph::contracts::SnapshotEdgeRecord;
using telegram::graph::core::GraphStore;

telegram::graph::config::ServiceConfig test_config() {
  return telegram::graph::config::ServiceConfig{
      .bind_host = "127.0.0.1",
      .bind_port = 0,
      .backend_snapshot_url = "",
      .internal_token = "",
      .backend_timeout_ms = 1000,
      .snapshot_refresh_secs = 60,
      .snapshot_page_size = 100,
      .min_edge_score = 0.0,
      .max_neighbors_per_user = 100,
      .max_branching_factor = 10,
      .default_neighbor_limit = 20,
      .default_author_limit = 20,
      .default_overlap_limit = 20,
      .default_max_depth = 2,
      .max_query_limit = 200,
      .max_query_depth = 3,
      .max_multi_hop_visited = 50000,
      .max_multi_hop_candidates = 20000,
      .http_max_connections = 256,
      .http_worker_count = 8,
      .http_queue_capacity = 512,
      .http_request_timeout_secs = 5,
      .http_max_body_bytes = 1024 * 1024,
  };
}

SnapshotEdgeRecord edge(const std::string& source, const std::string& target, const double score) {
  SnapshotEdgeRecord record;
  record.source_user_id = source;
  record.target_user_id = target;
  record.decayed_sum = score;
  record.interaction_probability = score;
  record.rollup_signal_counts.reply_count = score * 10.0;
  record.edge_kinds = {"test"};
  return record;
}

GraphStore build_store() {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "u2", 0.2),
          edge("u1", "u3", 0.9),
          edge("u1", "u4", 0.5),
          edge("u2", "u5", 0.7),
      },
      10,
      "test-snapshot",
      std::chrono::system_clock::now());
  return store;
}

void test_direct_neighbors_reports_full_available_count() {
  auto store = build_store();
  const auto result = store.direct_neighbors("u1", 2, {});

  assert(result.candidates.size() == 2);
  assert(result.available_count == 3);
}

void test_neighbor_limit_zero_keeps_available_count() {
  auto store = build_store();
  const auto result = store.direct_neighbors("u1", 0, {});

  assert(result.candidates.empty());
  assert(result.available_count == 3);
}

void test_ranked_neighbors_return_top_k_order() {
  auto store = build_store();
  const auto result = store.social_neighbors("u1", 2, {});

  assert(result.candidates.size() == 2);
  assert(result.available_count == 3);
  assert(result.candidates[0].user_id == "u3");
  assert(result.candidates[1].user_id == "u4");
}

void test_snapshot_aggregates_duplicate_edges() {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "u2", 0.2),
          edge("u1", "u2", 0.3),
          edge("u1", "u3", 0.1),
      },
      10,
      "dedupe-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.direct_neighbors("u1", 10, {});

  assert(result.available_count == 2);
  assert(result.candidates.size() == 2);
  assert(result.candidates[0].user_id == "u2");
  assert(std::abs(result.candidates[0].score - 0.5) < 1e-9);
}

void test_snapshot_metadata_reports_interning_layout() {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "u2", 0.2),
          edge("u1", "u3", 0.3),
          edge("u2", "u3", 0.4),
      },
      10,
      "interning-snapshot",
      std::chrono::system_clock::now());

  const auto metadata = store.metadata();

  assert(metadata.loaded);
  assert(metadata.layout_version == "adjacency-v3-interned-csr");
  assert(metadata.vertex_count == 3);
  assert(metadata.dense_vertex_count == metadata.vertex_count);
  assert(metadata.interned_edge_kind_count >= 1);
  assert(metadata.interner_memory_estimate_bytes > 0);
  assert(metadata.csr_source_count == metadata.vertex_count);
  assert(metadata.csr_neighbor_count == 3);
  assert(metadata.csr_memory_estimate_bytes > 0);
  assert(metadata.ranked_csr_neighbor_count == metadata.csr_neighbor_count);
  assert(metadata.ranked_csr_memory_estimate_bytes > 0);
  assert(metadata.memory_estimate_bytes >= metadata.interner_memory_estimate_bytes);
}

void test_overlap_large_intersection_uses_snapshot_index() {
  std::vector<SnapshotEdgeRecord> edges;
  for (int index = 0; index < 80; ++index) {
    edges.push_back(edge("uA", "shared-" + std::to_string(index), 0.2));
    edges.push_back(edge("uB", "shared-" + std::to_string(index), 0.3));
  }
  GraphStore store;
  store.replace_snapshot(edges, 100, "overlap-snapshot", std::chrono::system_clock::now());

  const auto result = store.overlap_candidates("uA", "uB", 5);

  assert(result.available_count == 80);
  assert(result.scanned_count == 160);
  assert(result.candidates.size() == 5);
}

void test_overlap_missing_user_uses_empty_dense_index() {
  auto store = build_store();
  const auto result = store.overlap_candidates("missing", "u1", 10);

  assert(result.candidates.empty());
  assert(result.available_count == 0);
  assert(result.scanned_count == 0);
}

void test_multi_hop_reports_budget_exhaustion() {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "u2", 0.9),
          edge("u1", "u3", 0.8),
          edge("u2", "u4", 0.7),
          edge("u3", "u5", 0.6),
      },
      10,
      "budget-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.multi_hop_candidates("u1", 10, 3, 10, 1, 100, {}, true);

  assert(result.visited_count > 1);
  assert(result.budget_exhausted);
}

void test_request_validation_rejects_missing_required_string() {
  const auto body = nlohmann::json::object();
  bool threw = false;
  try {
    (void)telegram::graph::http::read_required_string(body, "userId");
  } catch (const telegram::graph::http::RequestValidationError&) {
    threw = true;
  }
  if (!threw) {
    throw std::runtime_error("expected missing required string to be rejected");
  }
}

void test_request_validation_rejects_limit_over_maximum() {
  const auto body = nlohmann::json{{"limit", 201}};
  bool threw = false;
  try {
    (void)telegram::graph::http::read_optional_size(body, "limit", 40, 200);
  } catch (const telegram::graph::http::RequestValidationError&) {
    threw = true;
  }
  if (!threw) {
    throw std::runtime_error("expected over-limit value to be rejected");
  }
}

void test_request_validation_rejects_large_unsigned_limit() {
  const auto body = nlohmann::json{{"limit", std::numeric_limits<unsigned long long>::max()}};
  bool threw = false;
  try {
    (void)telegram::graph::http::read_optional_size(body, "limit", 40, 200);
  } catch (const telegram::graph::http::RequestValidationError&) {
    threw = true;
  }
  if (!threw) {
    throw std::runtime_error("expected large unsigned limit to be rejected");
  }
}

void test_request_validation_rejects_non_string_exclusions() {
  const auto body = nlohmann::json{{"excludeUserIds", nlohmann::json::array({"u2", 7})}};
  bool threw = false;
  try {
    (void)telegram::graph::http::read_optional_string_set(body, "excludeUserIds");
  } catch (const telegram::graph::http::RequestValidationError&) {
    threw = true;
  }
  if (!threw) {
    throw std::runtime_error("expected non-string exclusion to be rejected");
  }
}

void test_graph_handler_rejects_missing_user_id() {
  auto store = build_store();
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto config = test_config();
  const auto handler = telegram::graph::http::make_graph_handler(config, store, metrics);

  const auto response = handler(telegram::graph::http::HttpRequest{
      .method = "POST",
      .path = "/graph/neighbors",
      .body = "{}",
  });
  const auto body = nlohmann::json::parse(response.body);

  assert(response.status_code == 400);
  assert(body.at("success") == false);
  assert(body.at("error").at("code") == "INVALID_REQUEST");
}

void test_graph_handler_reports_unknown_get_without_snapshot() {
  GraphStore store;
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto config = test_config();
  const auto handler = telegram::graph::http::make_graph_handler(config, store, metrics);

  const auto response = handler(telegram::graph::http::HttpRequest{
      .method = "GET",
      .path = "/graph/neighbors",
  });
  const auto body = nlohmann::json::parse(response.body);

  assert(response.status_code == 404);
  assert(body.at("error").at("code") == "NOT_FOUND");
}

void test_graph_handler_requires_snapshot_for_post_queries() {
  GraphStore store;
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto config = test_config();
  const auto handler = telegram::graph::http::make_graph_handler(config, store, metrics);

  const auto response = handler(telegram::graph::http::HttpRequest{
      .method = "POST",
      .path = "/graph/neighbors",
      .body = R"({"userId":"u1"})",
  });
  const auto body = nlohmann::json::parse(response.body);

  assert(response.status_code == 503);
  assert(body.at("error").at("code") == "SNAPSHOT_UNAVAILABLE");
}

}  // namespace

int main() {
  test_direct_neighbors_reports_full_available_count();
  test_neighbor_limit_zero_keeps_available_count();
  test_ranked_neighbors_return_top_k_order();
  test_snapshot_aggregates_duplicate_edges();
  test_snapshot_metadata_reports_interning_layout();
  test_overlap_large_intersection_uses_snapshot_index();
  test_overlap_missing_user_uses_empty_dense_index();
  test_multi_hop_reports_budget_exhaustion();
  test_request_validation_rejects_missing_required_string();
  test_request_validation_rejects_limit_over_maximum();
  test_request_validation_rejects_large_unsigned_limit();
  test_request_validation_rejects_non_string_exclusions();
  test_graph_handler_rejects_missing_user_id();
  test_graph_handler_reports_unknown_get_without_snapshot();
  test_graph_handler_requires_snapshot_for_post_queries();
  return 0;
}
