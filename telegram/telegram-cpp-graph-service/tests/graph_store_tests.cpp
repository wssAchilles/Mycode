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
#include "graph/snapshot/snapshot_builder.h"
#include "graph/store/snapshot_data.h"
#include "http/graph_routes.h"
#include "http/runtime/runtime_metrics.h"
#include "http/request_validation.h"
#include "ops/metrics.h"
#include "snapshot/snapshot_loader.h"

namespace {

using telegram::graph::contracts::SnapshotEdgeRecord;
using telegram::graph::core::GraphStore;

class FakePagedSnapshotSource final : public telegram::graph::snapshot::SnapshotPageSource {
 public:
  explicit FakePagedSnapshotSource(std::vector<std::vector<SnapshotEdgeRecord>> pages)
      : pages_(std::move(pages)) {}

  telegram::graph::contracts::SnapshotPagePayload fetch_page(
      const std::size_t offset,
      const std::size_t limit,
      const double min_edge_score) const override {
    offsets.push_back(offset);
    limits.push_back(limit);
    min_scores.push_back(min_edge_score);
    const auto page_index = offset;
    if (page_index >= pages_.size()) {
      return telegram::graph::contracts::SnapshotPagePayload{
          .edges = {},
          .offset = offset,
          .limit = limit,
          .next_offset = std::nullopt,
          .done = true,
          .snapshot_version = "paged-snapshot",
      };
    }
    return telegram::graph::contracts::SnapshotPagePayload{
        .edges = pages_[page_index],
        .offset = offset,
        .limit = limit,
        .next_offset = page_index + 1 < pages_.size() ? std::optional<std::size_t>(page_index + 1) : std::nullopt,
        .done = page_index + 1 >= pages_.size(),
        .snapshot_version = "paged-snapshot",
    };
  }

  mutable std::vector<std::size_t> offsets;
  mutable std::vector<std::size_t> limits;
  mutable std::vector<double> min_scores;

 private:
  std::vector<std::vector<SnapshotEdgeRecord>> pages_;
};

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
      .traversal_best_first_enabled = false,
      .overlap_streaming_topk_enabled = true,
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

std::vector<std::string> neighbor_ids(
    const GraphStore::QueryCandidates<telegram::graph::contracts::NeighborCandidate>& result) {
  std::vector<std::string> ids;
  ids.reserve(result.candidates.size());
  for (const auto& candidate : result.candidates) {
    ids.push_back(candidate.user_id);
  }
  return ids;
}

std::vector<std::string> overlap_ids(
    const GraphStore::QueryCandidates<telegram::graph::contracts::OverlapCandidate>& result) {
  std::vector<std::string> ids;
  ids.reserve(result.candidates.size());
  for (const auto& candidate : result.candidates) {
    ids.push_back(candidate.user_id);
  }
  return ids;
}

std::vector<std::string> multi_hop_ids(
    const GraphStore::QueryCandidates<telegram::graph::contracts::MultiHopCandidate>& result) {
  std::vector<std::string> ids;
  ids.reserve(result.candidates.size());
  for (const auto& candidate : result.candidates) {
    ids.push_back(candidate.user_id);
  }
  return ids;
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
  EXPECT_EQ(metadata.snapshot_representation, "compact-csr");
  EXPECT_TRUE(metadata.compact_snapshot_enabled);
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
  EXPECT_TRUE(metadata.build_phase_duration_ms.contains("ingest"));
  EXPECT_TRUE(metadata.build_phase_duration_ms.contains("csrLayout"));
}

TEST(GraphStoreTest, CompactSnapshotMatchesOneShotQueries) {
  std::vector<SnapshotEdgeRecord> edges{
      edge("root", "a", 0.9),
      edge("root", "b", 0.7),
      edge("root", "c", 0.6),
      edge("a", "shared", 0.8),
      edge("b", "shared", 0.75),
      edge("a", "hop-a", 0.5),
      edge("b", "hop-b", 0.4),
      edge("overlap-a", "shared-1", 0.9),
      edge("overlap-b", "shared-1", 0.8),
      edge("overlap-a", "shared-2", 0.4),
      edge("overlap-b", "shared-2", 0.7),
      edge("overlap-a", "only-a", 0.3),
  };

  GraphStore one_shot;
  one_shot.replace_snapshot(edges, 20, "one-shot", std::chrono::system_clock::now());

  telegram::graph::core::snapshot::SnapshotAssembler<
      telegram::graph::core::store::SnapshotData,
      telegram::graph::core::domain::WeightedNeighbor>
      assembler(2);
  assembler.ingest_edges(std::span<const SnapshotEdgeRecord>(edges.data(), 4));
  assembler.ingest_edges(std::span<const SnapshotEdgeRecord>(edges.data() + 4, edges.size() - 4));

  GraphStore paged;
  paged.publish_snapshot(assembler.finish(
      20,
      "paged",
      std::chrono::system_clock::now(),
      telegram::graph::core::query::normalized_weight));

  EXPECT_EQ(
      neighbor_ids(one_shot.direct_neighbors("root", 3, {})),
      neighbor_ids(paged.direct_neighbors("root", 3, {})));
  EXPECT_EQ(
      neighbor_ids(one_shot.social_neighbors("root", 3, {})),
      neighbor_ids(paged.social_neighbors("root", 3, {})));
  EXPECT_EQ(
      overlap_ids(one_shot.overlap_candidates("overlap-a", "overlap-b", 10)),
      overlap_ids(paged.overlap_candidates("overlap-a", "overlap-b", 10)));
  EXPECT_EQ(
      multi_hop_ids(one_shot.multi_hop_candidates("root", 5, 3, 10, 100, 100, {}, true)),
      multi_hop_ids(paged.multi_hop_candidates("root", 5, 3, 10, 100, 100, {}, true)));
  EXPECT_EQ(paged.metadata().snapshot_representation, "compact-csr");
}

TEST(SnapshotLoaderTest, BuildsSnapshotIncrementallyFromPagedSource) {
  auto config = test_config();
  config.snapshot_page_size = 2;
  config.min_edge_score = 0.25;

  auto source = std::make_shared<FakePagedSnapshotSource>(std::vector<std::vector<SnapshotEdgeRecord>>{
      {edge("u1", "u2", 0.2), edge("u1", "u3", 0.9)},
      {edge("u2", "u4", 0.7)},
      {edge("u3", "u4", 0.6)},
  });
  GraphStore store;
  telegram::graph::ops::GraphServiceMetrics metrics;
  telegram::graph::snapshot::SnapshotLoader loader(config, source, store, metrics);

  loader.refresh_once();

  EXPECT_EQ(source->offsets, (std::vector<std::size_t>{0, 1, 2}));
  EXPECT_EQ(source->limits, (std::vector<std::size_t>{2, 2, 2}));
  EXPECT_EQ(source->min_scores, (std::vector<double>{0.25, 0.25, 0.25}));

  const auto result = store.direct_neighbors("u1", 10, {});
  ASSERT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.candidates[0].user_id, "u3");
  EXPECT_EQ(result.candidates[1].user_id, "u2");

  const auto metadata = store.metadata();
  EXPECT_TRUE(metadata.loaded);
  EXPECT_EQ(metadata.edge_count, 4u);
  EXPECT_EQ(metadata.snapshot_version, "paged-snapshot");
  EXPECT_TRUE(metadata.compact_snapshot_enabled);
  EXPECT_EQ(metadata.snapshot_representation, "compact-csr");
  EXPECT_TRUE(metadata.build_phase_duration_ms.contains("ingest"));
  EXPECT_TRUE(metadata.build_phase_duration_ms.contains("csrLayout"));
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

TEST(GraphStoreTest, OverlapStreamingTopKPreservesBestOrder) {
  std::vector<SnapshotEdgeRecord> edges;
  for (int index = 0; index < 256; ++index) {
    const auto user_id = "shared-" + std::to_string(index);
    edges.push_back(edge("uA", user_id, static_cast<double>(index) * 0.01));
    edges.push_back(edge("uB", user_id, static_cast<double>(255 - index) * 0.01));
  }
  edges.push_back(edge("uA", "winner-1", 9.0));
  edges.push_back(edge("uB", "winner-1", 8.0));
  edges.push_back(edge("uA", "winner-2", 7.5));
  edges.push_back(edge("uB", "winner-2", 7.6));

  GraphStore store;
  store.set_overlap_streaming_topk_enabled(true);
  store.replace_snapshot(edges, 300, "overlap-streaming-snapshot", std::chrono::system_clock::now());

  const auto result = store.overlap_candidates("uA", "uB", 2);

  ASSERT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.available_count, 258u);
  EXPECT_EQ(result.candidates[0].user_id, "winner-1");
  EXPECT_EQ(result.candidates[1].user_id, "winner-2");
  EXPECT_NEAR(result.candidates[0].combined_score, 17.0, 1e-9);
  EXPECT_NEAR(result.candidates[1].combined_score, 15.1, 1e-9);
}

TEST(GraphStoreTest, RankedNeighborsUseStableRequestLevelNowMs) {
  GraphStore store;
  auto stale = edge("u1", "stale", 0.7);
  stale.last_interaction_at_ms = 1;
  auto fresh = edge("u1", "fresh", 0.69);
  fresh.last_interaction_at_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                     std::chrono::system_clock::now().time_since_epoch())
                                     .count();
  store.replace_snapshot(
      {stale, fresh},
      10,
      "request-now-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.social_neighbors("u1", 2, {});

  ASSERT_EQ(result.candidates.size(), 2u);
  EXPECT_EQ(result.candidates[0].user_id, "fresh");
  EXPECT_EQ(result.available_count, 2u);
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
  store.set_traversal_best_first_enabled(true);
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

TEST(GraphStoreTest, MultiHopPrioritizesHigherScorePathsWithinVisitBudget) {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "u2", 0.95),
          edge("u1", "u3", 0.55),
          edge("u2", "high-target", 0.95),
          edge("u3", "low-target", 0.95),
          edge("high-target", "sink-a", 0.8),
          edge("low-target", "sink-b", 0.8),
      },
      10,
      "best-first-budget-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.multi_hop_candidates("u1", 10, 4, 10, 3, 100, {}, true);

  ASSERT_EQ(result.visited_count, 3u);
  EXPECT_TRUE(result.budget_exhausted);
  ASSERT_GE(result.candidates.size(), 1u);
  EXPECT_EQ(result.candidates[0].user_id, "high-target");
  const auto low_target_it = std::find_if(
      result.candidates.begin(),
      result.candidates.end(),
      [](const auto& candidate) { return candidate.user_id == "low-target"; });
  if (low_target_it != result.candidates.end()) {
    const auto low_target_index = static_cast<std::size_t>(
        std::distance(result.candidates.begin(), low_target_it));
    EXPECT_EQ(low_target_index, 1u);
  }
}

TEST(GraphStoreTest, MultiHopViaUserIdsAreSortedAndDeduplicated) {
  GraphStore store;
  store.replace_snapshot(
      {
          edge("u1", "u9", 0.7),
          edge("u1", "u2", 0.9),
          edge("u1", "u3", 0.8),
          edge("u2", "target", 0.7),
          edge("u2", "target", 0.6),
          edge("u3", "target", 0.65),
      },
      10,
      "via-dedupe-snapshot",
      std::chrono::system_clock::now());

  const auto result = store.multi_hop_candidates("u1", 10, 3, 10, 100, 100, {}, true);

  ASSERT_EQ(result.candidates.size(), 1u);
  EXPECT_EQ(result.candidates[0].user_id, "target");
  EXPECT_EQ(result.candidates[0].path_count, 2u);
  EXPECT_EQ(result.candidates[0].via_user_ids, (std::vector<std::string>{"u2", "u3"}));
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
