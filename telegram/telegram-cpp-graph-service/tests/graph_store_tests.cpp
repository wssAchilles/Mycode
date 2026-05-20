#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "config/config.h"
#include "contracts/types.h"
#include "graph/graph_store.h"
#include "graph/query/budget.h"
#include "graph/query/scoring.h"
#include "graph/snapshot/csr_index.h"
#include "http/graph_routes.h"
#include "http/runtime/runtime_metrics.h"
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

SnapshotEdgeRecord edge(const std::string& source, const std::string& target, double score) {
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

}  // namespace

TEST(GraphStoreTest, DirectNeighborsReportsFullAvailableCount) {
  auto store = build_store();
  const auto result = store.direct_neighbors("u1", 2, {});

  EXPECT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.available_count, 3u);
}

TEST(GraphStoreTest, NeighborLimitZeroKeepsAvailableCount) {
  auto store = build_store();
  const auto result = store.direct_neighbors("u1", 0, {});

  EXPECT_TRUE(result.candidates.empty());
  EXPECT_EQ(result.available_count, 3u);
}

TEST(GraphStoreTest, RankedNeighborsReturnTopKOrder) {
  auto store = build_store();
  const auto result = store.social_neighbors("u1", 2, {});

  EXPECT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.available_count, 3u);
  EXPECT_EQ(result.candidates[0].user_id, "u3");
  EXPECT_EQ(result.candidates[1].user_id, "u4");
}

TEST(GraphStoreTest, SnapshotAggregatesDuplicateEdges) {
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

  EXPECT_EQ(result.available_count, 2u);
  EXPECT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.candidates[0].user_id, "u2");
  EXPECT_NEAR(result.candidates[0].score, 0.5, 1e-9);
}

TEST(GraphStoreTest, SnapshotMergesDuplicateEdgeKindsOnce) {
  auto first = edge("u1", "u2", 0.2);
  first.edge_kinds = {"manual", "shared"};
  auto second = edge("u1", "u2", 0.3);
  second.edge_kinds = {"manual", "extra"};

  GraphStore store;
  store.replace_snapshot(
      {first, second},
      10,
      "dedupe-kinds-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.direct_neighbors("u1", 10, {});
  const auto& relation_kinds = result.candidates.at(0).relation_kinds;

  EXPECT_EQ(std::count(relation_kinds.begin(), relation_kinds.end(), "manual"), 1);
  EXPECT_NE(std::find(relation_kinds.begin(), relation_kinds.end(), "shared"), relation_kinds.end());
  EXPECT_NE(std::find(relation_kinds.begin(), relation_kinds.end(), "extra"), relation_kinds.end());
}

TEST(GraphStoreTest, SnapshotRetainsTopNeighborsPerSource) {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "low", 0.1),
          edge("u1", "high", 0.9),
          edge("u1", "middle", 0.5),
      },
      2,
      "retention-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.direct_neighbors("u1", 10, {});

  EXPECT_EQ(result.available_count, 2u);
  EXPECT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.candidates[0].user_id, "high");
  EXPECT_EQ(result.candidates[1].user_id, "middle");
  EXPECT_EQ(store.metadata().csr_neighbor_count, 2u);
}

TEST(GraphStoreTest, SnapshotMetadataReportsInterningLayout) {
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

  EXPECT_TRUE(metadata.loaded);
  EXPECT_EQ(metadata.layout_version, "adjacency-v3-interned-csr");
  EXPECT_EQ(metadata.vertex_count, 3u);
  EXPECT_EQ(metadata.dense_vertex_count, metadata.vertex_count);
  EXPECT_GE(metadata.interned_edge_kind_count, 1u);
  EXPECT_GT(metadata.interner_memory_estimate_bytes, 0u);
  EXPECT_EQ(metadata.csr_source_count, metadata.vertex_count);
  EXPECT_EQ(metadata.csr_neighbor_count, 3u);
  EXPECT_GT(metadata.csr_memory_estimate_bytes, 0u);
  EXPECT_EQ(metadata.ranked_csr_neighbor_count, metadata.csr_neighbor_count);
  EXPECT_GT(metadata.ranked_csr_memory_estimate_bytes, 0u);
  EXPECT_GE(metadata.memory_estimate_bytes, metadata.interner_memory_estimate_bytes);
}

TEST(GraphStoreTest, OverlapLargeIntersectionUsesSnapshotIndex) {
  std::vector<SnapshotEdgeRecord> edges;
  for (int index = 0; index < 80; ++index) {
    edges.push_back(edge("uA", "shared-" + std::to_string(index), 0.2));
    edges.push_back(edge("uB", "shared-" + std::to_string(index), 0.3));
  }
  GraphStore store;
  store.replace_snapshot(edges, 100, "overlap-snapshot", std::chrono::system_clock::now());

  const auto result = store.overlap_candidates("uA", "uB", 5);

  EXPECT_EQ(result.available_count, 80u);
  EXPECT_EQ(result.scanned_count, 160u);
  EXPECT_EQ(result.candidates.size(), 5u);
}

TEST(GraphStoreTest, OverlapMissingUserUsesEmptyDenseIndex) {
  auto store = build_store();
  const auto result = store.overlap_candidates("missing", "u1", 10);

  EXPECT_TRUE(result.candidates.empty());
  EXPECT_EQ(result.available_count, 0u);
  EXPECT_EQ(result.scanned_count, 0u);
}

TEST(GraphStoreTest, MultiHopReportsBudgetExhaustion) {
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

  const auto result = store.multi_hop_candidates("u1", 10, 3, 10, 2, 100, {}, true);

  EXPECT_GE(result.visited_count, 1u);
  EXPECT_TRUE(result.budget_exhausted);
}

TEST(TraversalBudgetTest, TrackerMarksCandidateExhaustion) {
  telegram::graph::core::query::TraversalBudgetTracker tracker(
      telegram::graph::core::query::TraversalBudget{
          .max_visited_nodes = 3,
          .max_candidates = 1,
      });

  EXPECT_TRUE(tracker.record_visit());
  EXPECT_TRUE(tracker.record_visit());
  EXPECT_FALSE(tracker.record_visit());
  EXPECT_FALSE(tracker.can_add_new_candidate(1));
  EXPECT_EQ(tracker.visited_count(), 3u);
  EXPECT_TRUE(tracker.exhausted());
}

TEST(QueryScoringTest, DerivesRelationKinds) {
  GraphStore::WeightedNeighbor neighbor;
  neighbor.user_id = "u2";
  neighbor.score = 0.8;
  neighbor.interaction_probability = 0.4;
  neighbor.rollup_signal_counts.follow_count = 1;
  neighbor.rollup_signal_counts.reply_count = 2;
  neighbor.rollup_signal_counts.content_affinity_count = 1;

  const auto weight = telegram::graph::core::query::social_weight(neighbor);
  const auto relation_kinds = telegram::graph::core::query::relation_kinds(neighbor);

  EXPECT_GT(weight, 0.0);
  EXPECT_NE(std::find(relation_kinds.begin(), relation_kinds.end(), "follow"), relation_kinds.end());
  EXPECT_NE(std::find(relation_kinds.begin(), relation_kinds.end(), "reply"), relation_kinds.end());
  EXPECT_NE(std::find(relation_kinds.begin(), relation_kinds.end(), "content_affinity"), relation_kinds.end());
}

TEST(CsrIndexTest, FlattensAndReadsSpans) {
  using Ref = int;
  std::vector<std::vector<Ref>> grouped{{1, 2}, {}, {3}};
  std::vector<std::size_t> offsets;
  std::vector<Ref> flat;

  telegram::graph::core::snapshot::flatten_csr_index(grouped, offsets, flat);

  EXPECT_EQ(offsets, (std::vector<std::size_t>{0, 2, 2, 3}));

  const auto first = telegram::graph::core::snapshot::read_csr_span(offsets, flat, 0);
  const auto empty = telegram::graph::core::snapshot::read_csr_span(offsets, flat, 1);
  const auto third = telegram::graph::core::snapshot::read_csr_span(offsets, flat, 2);

  ASSERT_EQ(first.size(), 2u);
  EXPECT_EQ(first[0], 1);
  EXPECT_EQ(first[1], 2);
  EXPECT_TRUE(empty.empty());
  ASSERT_EQ(third.size(), 1u);
  EXPECT_EQ(third[0], 3);
}

TEST(RequestValidationTest, RejectsMissingRequiredString) {
  const auto body = nlohmann::json::object();
  EXPECT_THROW(
      (void)telegram::graph::http::read_required_string(body, "userId"),
      telegram::graph::http::RequestValidationError);
}

TEST(RequestValidationTest, RejectsLimitOverMaximum) {
  const auto body = nlohmann::json{{"limit", 201}};
  EXPECT_THROW(
      (void)telegram::graph::http::read_optional_size(body, "limit", 40, 200),
      telegram::graph::http::RequestValidationError);
}

TEST(RequestValidationTest, RejectsLargeUnsignedLimit) {
  const auto body = nlohmann::json{{"limit", std::numeric_limits<unsigned long long>::max()}};
  EXPECT_THROW(
      (void)telegram::graph::http::read_optional_size(body, "limit", 40, 200),
      telegram::graph::http::RequestValidationError);
}

TEST(RequestValidationTest, RejectsNonStringExclusions) {
  const auto body = nlohmann::json{{"excludeUserIds", nlohmann::json::array({"u2", 7})}};
  EXPECT_THROW(
      (void)telegram::graph::http::read_optional_string_set(body, "excludeUserIds"),
      telegram::graph::http::RequestValidationError);
}

TEST(GraphHandlerTest, RejectsMissingUserId) {
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

  EXPECT_EQ(response.status_code, 400);
  EXPECT_EQ(body.at("success"), false);
  EXPECT_EQ(body.at("error").at("code"), "INVALID_REQUEST");
}

TEST(GraphHandlerTest, ReportsUnknownGetWithoutSnapshot) {
  GraphStore store;
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto config = test_config();
  const auto handler = telegram::graph::http::make_graph_handler(config, store, metrics);

  const auto response = handler(telegram::graph::http::HttpRequest{
      .method = "GET",
      .path = "/graph/neighbors",
  });
  const auto body = nlohmann::json::parse(response.body);

  EXPECT_EQ(response.status_code, 404);
  EXPECT_EQ(body.at("error").at("code"), "NOT_FOUND");
}

TEST(GraphHandlerTest, RequiresSnapshotForPostQueries) {
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

  EXPECT_EQ(response.status_code, 503);
  EXPECT_EQ(body.at("error").at("code"), "SNAPSHOT_UNAVAILABLE");
}

TEST(OpsPayloadTest, ReportsHttpRuntimeMetrics) {
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto runtime_metrics = std::make_shared<telegram::graph::http::HttpRuntimeMetrics>();
  metrics.attach_http_runtime_metrics(runtime_metrics);
  runtime_metrics->record_accept();
  runtime_metrics->record_reject();
  runtime_metrics->set_active_connections(2);
  runtime_metrics->set_queue_depth(3);
  runtime_metrics->record_read_error(413);
  metrics.record_query(
      "social_neighbors",
      2,
      5,
      2,
      5,
      1,
      false,
      std::chrono::milliseconds(7),
      std::nullopt);
  metrics.record_query(
      "bridge_users",
      2,
      2,
      0,
      4,
      3,
      true,
      std::chrono::milliseconds(11),
      std::string("budget_exhausted"));

  const auto payload = metrics.ops_payload(test_config(), GraphStore{}.metadata());
  const auto http_runtime = payload.at("httpRuntime");
  const auto requests = payload.at("requests");
  const auto kernel_route_summary = requests.at("kernelRouteSummary");
  const auto social_summary = kernel_route_summary.at("social_neighbors");
  const auto bridge_summary = kernel_route_summary.at("bridge_users");

  EXPECT_EQ(http_runtime.at("acceptedConnections"), 1);
  EXPECT_EQ(http_runtime.at("rejectedConnections"), 1);
  EXPECT_EQ(http_runtime.at("activeConnections"), 2);
  EXPECT_EQ(http_runtime.at("queueDepth"), 3);
  EXPECT_EQ(http_runtime.at("bodyTooLarge"), 1);
  EXPECT_EQ(social_summary.at("requestCount"), 1);
  EXPECT_EQ(social_summary.at("lastTruncatedCount"), 3);
  EXPECT_EQ(social_summary.at("truncatedRequestCount"), 1);
  EXPECT_EQ(social_summary.at("budgetExhaustedCount"), 0);
  EXPECT_EQ(social_summary.at("p99Ms"), 7);
  EXPECT_EQ(bridge_summary.at("budgetExhaustedCount"), 1);
  EXPECT_EQ(bridge_summary.at("emptyReasonCounts").at("budget_exhausted"), 1);
}
