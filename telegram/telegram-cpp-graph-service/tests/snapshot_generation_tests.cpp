#include <chrono>
#include <cstdlib>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "config/config.h"
#include "graph/graph_store.h"
#include "graph/query/scoring.h"
#include "graph/snapshot/snapshot_builder.h"
#include "graph/store/snapshot_data.h"
#include "ops/metrics.h"
#include "snapshot/backend_snapshot_client.h"
#include "snapshot/generation_protocol.h"
#include "snapshot/snapshot_loader.h"

namespace {

namespace generation = telegram::graph::snapshot::generation;

constexpr auto kHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const std::string kGenerationId = std::string("graph_generation_v2:") + kHash;
constexpr auto kLoaderHash = "a5382882f59956efb3bfc162eb788d56ee273e84b97b0022ccb03da239dd0824";
const std::string kLoaderGenerationId =
    std::string("graph_generation_v2:") + kLoaderHash;
const std::string kOtherGenerationId =
    std::string("graph_generation_v2:") + std::string(64, 'b');

class ScopedEnv {
 public:
  explicit ScopedEnv(std::string name) : name_(std::move(name)) {
    if (const auto* value = std::getenv(name_.c_str()); value != nullptr) {
      original_ = value;
    }
  }

  ~ScopedEnv() {
    if (original_.has_value()) {
      (void)setenv(name_.c_str(), original_->c_str(), 1);
    } else {
      (void)unsetenv(name_.c_str());
    }
  }

  void set(const std::string& value) { (void)setenv(name_.c_str(), value.c_str(), 1); }
  void unset() { (void)unsetenv(name_.c_str()); }

 private:
  std::string name_;
  std::optional<std::string> original_;
};

nlohmann::json canonical_counts() {
  return nlohmann::json{
      {"followCount", 0},
      {"likeCount", 0},
      {"replyCount", 0},
      {"retweetCount", 0},
      {"quoteCount", 0},
      {"mentionCount", 0},
      {"profileViewCount", 0},
      {"tweetClickCount", 0},
      {"dwellTimeMs", 0},
      {"addressBookCount", 0},
      {"directMessageCount", 0},
      {"coEngagementCount", 0},
      {"contentAffinityCount", 0},
      {"muteCount", 0},
      {"blockCount", 0},
      {"reportCount", 0},
  };
}

nlohmann::json valid_envelope() {
  return nlohmann::json{
      {"success", true},
      {"data",
       {
           {"generationId", kGenerationId},
           {"leaseId", "lease-1"},
           {"expiresAt", 10'000},
           {"manifest",
            {
                {"generationId", kGenerationId},
                {"contentVersion", std::string("sha256:") + kHash},
                {"status", "ready"},
                {"edgeCount", 1},
                {"canonicalSha256", kHash},
                {"createdAt", 1'000},
                {"diagnostic", "verified"},
            }},
           {"edges",
            nlohmann::json::array({
                {
                    {"sourceUserId", "source"},
                    {"targetUserId", "target"},
                    {"edgeId", "edge-1"},
                    {"decayedSum", 1.0},
                    {"interactionProbability", 0.5},
                    {"dailySignalCounts", canonical_counts()},
                    {"rollupSignalCounts", canonical_counts()},
                    {"edgeKinds", nlohmann::json::array({"follow"})},
                    {"lastInteractionAtMs", nullptr},
                    {"updatedAtMs", 900},
                },
            })},
           {"nextCursor", nullptr},
           {"done", true},
       }},
  };
}

telegram::graph::contracts::SnapshotEdgeRecord snapshot_edge(
    std::string source,
    std::string target,
    const double score = 1.0) {
  telegram::graph::contracts::SnapshotEdgeRecord record;
  record.source_user_id = std::move(source);
  record.target_user_id = std::move(target);
  record.decayed_sum = score;
  record.interaction_probability = 0.5;
  record.edge_kinds = {"follow"};
  return record;
}

generation::Edge generation_edge(
    std::string source,
    std::string target,
    std::string edge_id,
    const double score = 1.0) {
  return generation::Edge{
      .edge_id = std::move(edge_id),
      .record = snapshot_edge(std::move(source), std::move(target), score),
  };
}

generation::Edge canonical_contract_edge(std::string source, std::string edge_id) {
  auto edge = generation_edge(std::move(source), "target", std::move(edge_id), 1.5);
  edge.record.interaction_probability = 0.25;
  const auto counts = telegram::graph::contracts::EdgeSignalCounts{
      .follow_count = 1,
      .like_count = 2,
      .reply_count = 3,
      .retweet_count = 4,
      .quote_count = 5,
      .mention_count = 6,
      .profile_view_count = 7,
      .tweet_click_count = 8,
      .dwell_time_ms = 9,
      .address_book_count = 10,
      .direct_message_count = 11,
      .co_engagement_count = 12,
      .content_affinity_count = 13,
      .mute_count = 14,
      .block_count = 15,
      .report_count = 16,
  };
  edge.record.daily_signal_counts = counts;
  edge.record.rollup_signal_counts = counts;
  edge.record.edge_kinds = {"follow", "like"};
  return edge;
}

generation::Cursor cursor_for(const generation::Edge& edge) {
  return generation::Cursor{
      .generation_id = kLoaderGenerationId,
      .after_source_user_id = edge.record.source_user_id,
      .after_target_user_id = edge.record.target_user_id,
      .after_edge_id = edge.edge_id,
  };
}

generation::Manifest manifest(const std::size_t edge_count = 3) {
  return generation::Manifest{
      .generation_id = kLoaderGenerationId,
      .content_version = std::string("sha256:") + kLoaderHash,
      .status = "ready",
      .edge_count = edge_count,
      .canonical_sha256 = kLoaderHash,
      .created_at_ms = 500,
      .diagnostic = std::string("verified"),
  };
}

std::vector<generation::Page> valid_pages() {
  std::vector<generation::Edge> first_edges{
      generation_edge("a", "b", "edge-1"),
      generation_edge("a", "c", "edge-2"),
  };
  std::vector<generation::Edge> second_edges{
      generation_edge("b", "c", "edge-3"),
  };
  return {
      generation::Page{
          .generation_id = kLoaderGenerationId,
          .lease_id = "lease-1",
          .expires_at_ms = 10'000,
          .manifest = manifest(),
          .edges = first_edges,
          .next_cursor = cursor_for(first_edges.back()),
          .done = false,
      },
      generation::Page{
          .generation_id = kLoaderGenerationId,
          .lease_id = "lease-1",
          .expires_at_ms = 12'000,
          .manifest = manifest(),
          .edges = second_edges,
          .next_cursor = std::nullopt,
          .done = true,
      },
  };
}

class FakeGenerationPageSource final : public generation::PageSource {
 public:
  explicit FakeGenerationPageSource(std::vector<generation::Page> pages)
      : pages(std::move(pages)) {}

  generation::Page fetch_page(const generation::PageRequest& request) const override {
    const auto index = requests.size();
    requests.push_back(request);
    events.push_back("fetch");
    if (fail_fetch_at.has_value() && index == fail_fetch_at.value()) {
      throw std::runtime_error("injected generation fetch failure");
    }
    if (index >= pages.size()) {
      throw std::runtime_error("unexpected generation fetch");
    }
    return pages[index];
  }

  void release(const std::string& generation_id, const std::string& lease_id) const override {
    releases.emplace_back(generation_id, lease_id);
    events.push_back("release");
    if (on_release) {
      on_release();
    }
    if (fail_release) {
      throw std::runtime_error("injected generation release failure");
    }
  }

  std::vector<generation::Page> pages;
  mutable std::vector<generation::PageRequest> requests;
  mutable std::vector<std::pair<std::string, std::string>> releases;
  mutable std::vector<std::string> events;
  std::optional<std::size_t> fail_fetch_at;
  bool fail_release{false};
  std::function<void()> on_release;
};

auto fixed_clock() {
  return [] {
    return std::chrono::system_clock::time_point{std::chrono::milliseconds(1'000)};
  };
}

nlohmann::json refresh_metrics(
    const telegram::graph::ops::GraphServiceMetrics& metrics,
    const telegram::graph::core::GraphStore& store) {
  return metrics.ops_payload(
      telegram::graph::config::ServiceConfig{},
      store.metadata()).at("refresh");
}

TEST(GenerationProtocolTest, SerializesExactFirstContinuationAndReleaseBodies) {
  EXPECT_EQ(
      generation::serialize_page_request(generation::PageRequest{.limit = 17}),
      nlohmann::json({{"limit", 17}}));

  const generation::Cursor cursor{
      .generation_id = kGenerationId,
      .after_source_user_id = "source",
      .after_target_user_id = "target",
      .after_edge_id = "edge-1",
  };
  EXPECT_EQ(
      generation::serialize_page_request(generation::PageRequest{
          .limit = 23,
          .lease_id = "lease-1",
          .cursor = cursor,
      }),
      nlohmann::json({
          {"limit", 23},
          {"leaseId", "lease-1"},
          {"cursor",
           {
               {"generationId", kGenerationId},
               {"afterSourceUserId", "source"},
               {"afterTargetUserId", "target"},
               {"afterEdgeId", "edge-1"},
           }},
      }));
  EXPECT_EQ(
      generation::serialize_release_request(kGenerationId, "lease-1"),
      nlohmann::json({{"generationId", kGenerationId}, {"leaseId", "lease-1"}}));
}

TEST(GenerationProtocolTest, RejectsIncompleteContinuationRequests) {
  EXPECT_THROW(
      (void)generation::serialize_page_request(generation::PageRequest{
          .limit = 17,
          .lease_id = "lease-1",
      }),
      std::invalid_argument);
  EXPECT_THROW(
      (void)generation::serialize_page_request(generation::PageRequest{
          .limit = 17,
          .cursor = generation::Cursor{
              .generation_id = kGenerationId,
              .after_source_user_id = "source",
              .after_target_user_id = "target",
              .after_edge_id = "edge-1",
          },
      }),
      std::invalid_argument);
}

TEST(GenerationProtocolTest, ParsesReadyEnvelopeAndToleratesManifestMetadata) {
  const auto page = generation::parse_page_envelope(valid_envelope());

  EXPECT_EQ(page.generation_id, kGenerationId);
  EXPECT_EQ(page.lease_id, "lease-1");
  EXPECT_EQ(page.expires_at_ms, 10'000);
  EXPECT_EQ(page.manifest.edge_count, 1u);
  EXPECT_EQ(page.manifest.created_at_ms, 1'000);
  ASSERT_EQ(page.edges.size(), 1u);
  EXPECT_EQ(page.edges.front().edge_id, "edge-1");
  EXPECT_EQ(page.edges.front().record.source_user_id, "source");
  EXPECT_TRUE(page.done);
  EXPECT_FALSE(page.next_cursor.has_value());
}

TEST(GenerationProtocolTest, RejectsUnsafeTimestampHashIdentityAndCanonicalFields) {
  struct InvalidCase {
    const char* name;
    std::function<void(nlohmann::json&)> mutate;
  };
  const std::vector<InvalidCase> cases{
      {"unsuccessful envelope", [](auto& json) { json["success"] = false; }},
      {"negative expiry", [](auto& json) { json["data"]["expiresAt"] = -1; }},
      {"fractional expiry", [](auto& json) { json["data"]["expiresAt"] = 1.5; }},
      {"unsafe expiry", [](auto& json) { json["data"]["expiresAt"] = 9'007'199'254'740'992ULL; }},
      {"unsafe created at", [](auto& json) {
         json["data"]["manifest"]["createdAt"] = 9'007'199'254'740'992ULL;
       }},
      {"unsafe edge count", [](auto& json) {
         json["data"]["manifest"]["edgeCount"] = 9'007'199'254'740'992ULL;
       }},
      {"non-ready manifest", [](auto& json) { json["data"]["manifest"]["status"] = "building"; }},
      {"uppercase hash", [](auto& json) {
         json["data"]["manifest"]["canonicalSha256"] =
             "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
       }},
      {"page manifest drift", [](auto& json) {
         json["data"]["manifest"]["generationId"] =
             std::string("graph_generation_v2:") + std::string(64, 'b');
       }},
      {"generation hash mismatch", [](auto& json) {
         const auto generation_id = std::string("graph_generation_v2:") + std::string(64, 'b');
         json["data"]["generationId"] = generation_id;
         json["data"]["manifest"]["generationId"] = generation_id;
       }},
      {"missing canonical field", [](auto& json) {
         json["data"]["manifest"].erase("edgeCount");
       }},
      {"missing content version", [](auto& json) {
         json["data"]["manifest"].erase("contentVersion");
       }},
      {"blank content version", [](auto& json) {
         json["data"]["manifest"]["contentVersion"] = "";
       }},
      {"mismatched content version", [](auto& json) {
         json["data"]["manifest"]["contentVersion"] = "sha256:other";
       }},
      {"invalid diagnostic", [](auto& json) {
         json["data"]["manifest"]["diagnostic"] = 7;
       }},
      {"unexpected control revision", [](auto& json) {
         json["data"]["manifest"]["controlRevision"] = 7;
       }},
      {"unexpected control", [](auto& json) {
         json["data"]["manifest"]["control"] = nlohmann::json::object();
       }},
      {"blank edge identity", [](auto& json) {
         json["data"]["edges"][0]["edgeId"] = "";
       }},
      {"negative last interaction", [](auto& json) {
         json["data"]["edges"][0]["lastInteractionAtMs"] = -1;
       }},
      {"negative updated at", [](auto& json) {
         json["data"]["edges"][0]["updatedAtMs"] = -1;
       }},
      {"missing daily count", [](auto& json) {
         json["data"]["edges"][0]["dailySignalCounts"].erase("followCount");
       }},
      {"extra daily count", [](auto& json) {
         json["data"]["edges"][0]["dailySignalCounts"]["unknownCount"] = 0;
       }},
      {"missing rollup count", [](auto& json) {
         json["data"]["edges"][0]["rollupSignalCounts"].erase("reportCount");
       }},
      {"extra rollup count", [](auto& json) {
         json["data"]["edges"][0]["rollupSignalCounts"]["unknownCount"] = 0;
       }},
  };

  for (const auto& test_case : cases) {
    SCOPED_TRACE(test_case.name);
    auto envelope = valid_envelope();
    test_case.mutate(envelope);
    EXPECT_THROW((void)generation::parse_page_envelope(envelope), std::invalid_argument);
  }
}

TEST(GenerationProtocolTest, ManifestIdentityIncludesContentVersionAndDiagnostic) {
  const auto first = generation::parse_page_envelope(valid_envelope()).manifest;
  auto diagnostic_drift = valid_envelope();
  diagnostic_drift["data"]["manifest"]["diagnostic"] = "changed";

  EXPECT_EQ(first.content_version, std::string("sha256:") + kHash);
  EXPECT_NE(
      first,
      generation::parse_page_envelope(diagnostic_drift).manifest);
}

TEST(GenerationProtocolTest, HashesNodeCanonicalNdjsonFixture) {
  generation::CanonicalEdgeHasher hasher;
  hasher.update(canonical_contract_edge("a", "edge-a"));
  hasher.update(canonical_contract_edge("\xEE\x80\x80", "edge-b"));
  hasher.update(canonical_contract_edge("\xF0\x90\x80\x80", "edge-c"));

  EXPECT_EQ(
      hasher.finish(),
      "a111ed4c0969f6f5bbda9ee35da0d9b2b71e3a57174229844a0e9ce3e2b4be42");
}

TEST(GenerationProtocolTest, HashesEcmascriptNumericBoundaries) {
  auto edge = generation_edge("numeric", "target", "edge", -0.0);
  edge.record.interaction_probability = 1e21;
  const auto counts = telegram::graph::contracts::EdgeSignalCounts{
      .follow_count = 1e20,
      .like_count = 1e21,
      .reply_count = 1e-6,
      .retweet_count = 1e-7,
      .quote_count = 123,
      .mention_count = -0.0,
      .profile_view_count = 0.00001,
      .tweet_click_count = 0.0000001,
      .dwell_time_ms = 1.2345678901234567,
      .address_book_count = 9007199254740991.0,
      .direct_message_count = -1.25,
      .co_engagement_count = 1.2e20,
      .content_affinity_count = 1.2e21,
      .mute_count = 2.2250738585072014e-308,
      .block_count = 5e-324,
      .report_count = 1.7976931348623157e308,
  };
  edge.record.daily_signal_counts = counts;
  edge.record.rollup_signal_counts = counts;

  generation::CanonicalEdgeHasher hasher;
  hasher.update(edge);

  EXPECT_EQ(
      hasher.finish(),
      "086bb42e3a51006814dfc2672152587f43720caef232d8d04945009475b9a5c7");
}

TEST(GenerationProtocolTest, ValidatesReleaseEnvelopeIdentity) {
  generation::validate_release_envelope(
      nlohmann::json{
          {"success", true},
          {"data", {{"generationId", kGenerationId}, {"leaseId", "lease-1"}, {"released", true}}},
      },
      kGenerationId,
      "lease-1");

  EXPECT_THROW(
      generation::validate_release_envelope(
          nlohmann::json{
              {"success", true},
              {"data", {{"generationId", kGenerationId}, {"leaseId", "other"}, {"released", true}}},
          },
          kGenerationId,
          "lease-1"),
      std::invalid_argument);
}

TEST(BackendGenerationClientTest, UsesGenerationEndpointsAndExactProtocolBodies) {
  struct Request {
    std::string url;
    nlohmann::json body;
    std::string token;
    std::uint64_t timeout_ms;
  };
  std::vector<Request> requests;
  telegram::graph::snapshot::BackendGenerationClient client(
      "http://backend/internal/graph-kernel/snapshot",
      "internal-token",
      4321,
      [&requests](
          const std::string& url,
          const nlohmann::json& body,
          const std::string& token,
          const std::uint64_t timeout_ms) {
        requests.push_back(Request{url, body, token, timeout_ms});
        if (url.ends_with("/release")) {
          return nlohmann::json{
              {"success", true},
              {"data",
               {
                   {"generationId", kGenerationId},
                   {"leaseId", "lease-1"},
                   {"released", true},
               }},
          };
        }
        return valid_envelope();
      });
  const auto cursor = generation::Cursor{
      .generation_id = kGenerationId,
      .after_source_user_id = "source",
      .after_target_user_id = "target",
      .after_edge_id = "edge-1",
  };

  (void)client.fetch_page(generation::PageRequest{.limit = 17});
  (void)client.fetch_page(generation::PageRequest{
      .limit = 23,
      .lease_id = "lease-1",
      .cursor = cursor,
  });
  client.release(kGenerationId, "lease-1");

  ASSERT_EQ(requests.size(), 3u);
  EXPECT_EQ(
      requests[0].url,
      "http://backend/internal/graph-kernel/snapshot/generation/page");
  EXPECT_EQ(requests[0].body, nlohmann::json({{"limit", 17}}));
  EXPECT_EQ(
      requests[1].url,
      "http://backend/internal/graph-kernel/snapshot/generation/page");
  EXPECT_EQ(
      requests[1].body,
      generation::serialize_page_request(generation::PageRequest{
          .limit = 23,
          .lease_id = "lease-1",
          .cursor = cursor,
      }));
  EXPECT_EQ(
      requests[2].url,
      "http://backend/internal/graph-kernel/snapshot/generation/release");
  EXPECT_EQ(
      requests[2].body,
      nlohmann::json({{"generationId", kGenerationId}, {"leaseId", "lease-1"}}));
  for (const auto& request : requests) {
    EXPECT_EQ(request.token, "internal-token");
    EXPECT_EQ(request.timeout_ms, 4321u);
  }
}

TEST(GenerationConfigTest, DefaultsDisabledAndParsesExplicitTrue) {
  ScopedEnv generation_flag("GRAPH_KERNEL_SNAPSHOT_GENERATION_V2_ENABLED");
  ScopedEnv bind_addr("GRAPH_KERNEL_BIND_ADDR");
  bind_addr.set("127.0.0.1:4300");

  generation_flag.unset();
  EXPECT_FALSE(telegram::graph::config::load_from_env().snapshot_generation_v2_enabled);

  generation_flag.set("true");
  EXPECT_TRUE(telegram::graph::config::load_from_env().snapshot_generation_v2_enabled);

  generation_flag.set("0");
  EXPECT_FALSE(telegram::graph::config::load_from_env().snapshot_generation_v2_enabled);
}

TEST(SnapshotRefresherTest, LegacyAndGenerationLoadersShareOneRuntimeContract) {
  EXPECT_TRUE((std::is_base_of_v<
               telegram::graph::snapshot::SnapshotRefresher,
               telegram::graph::snapshot::SnapshotLoader>));
  EXPECT_TRUE((std::is_base_of_v<
               telegram::graph::snapshot::SnapshotRefresher,
               telegram::graph::snapshot::GenerationSnapshotLoader>));
}

TEST(GenerationSnapshotLoaderTest, PublishesThenReleasesOnceThenRecordsSuccess) {
  telegram::graph::core::GraphStore store;
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto source = std::make_shared<FakeGenerationPageSource>(valid_pages());
  source->on_release = [&] {
    EXPECT_EQ(store.metadata().snapshot_version, kLoaderGenerationId);
    EXPECT_EQ(refresh_metrics(metrics, store).at("successes"), 0);
  };
  telegram::graph::snapshot::GenerationSnapshotLoader loader(
      2,
      10,
      source,
      store,
      metrics,
      fixed_clock());

  loader.refresh_once();

  ASSERT_EQ(source->requests.size(), 2u);
  EXPECT_EQ(source->requests[0].limit, 2u);
  EXPECT_FALSE(source->requests[0].lease_id.has_value());
  EXPECT_FALSE(source->requests[0].cursor.has_value());
  EXPECT_EQ(source->requests[1].limit, 2u);
  EXPECT_EQ(source->requests[1].lease_id, std::optional<std::string>("lease-1"));
  ASSERT_TRUE(source->requests[1].cursor.has_value());
  EXPECT_EQ(source->requests[1].cursor.value(), cursor_for(source->pages[0].edges.back()));
  EXPECT_EQ(source->events, (std::vector<std::string>{"fetch", "fetch", "release"}));
  EXPECT_EQ(
      source->releases,
      (std::vector<std::pair<std::string, std::string>>{{kLoaderGenerationId, "lease-1"}}));
  EXPECT_EQ(store.metadata().snapshot_version, kLoaderGenerationId);
  EXPECT_EQ(store.metadata().edge_count, 3u);
  const auto refresh = refresh_metrics(metrics, store);
  EXPECT_EQ(refresh.at("successes"), 1);
  EXPECT_EQ(refresh.at("failures"), 0);
}

TEST(GenerationSnapshotLoaderTest, ReleaseFailureDoesNotChangePublishedSuccess) {
  telegram::graph::core::GraphStore store;
  telegram::graph::ops::GraphServiceMetrics metrics;
  auto source = std::make_shared<FakeGenerationPageSource>(valid_pages());
  source->fail_release = true;
  telegram::graph::snapshot::GenerationSnapshotLoader loader(
      2,
      10,
      source,
      store,
      metrics,
      fixed_clock());

  EXPECT_NO_THROW(loader.refresh_once());

  EXPECT_EQ(store.metadata().snapshot_version, kLoaderGenerationId);
  ASSERT_EQ(source->releases.size(), 1u);
  const auto refresh = refresh_metrics(metrics, store);
  EXPECT_EQ(refresh.at("successes"), 1);
  EXPECT_EQ(refresh.at("failures"), 0);
}

TEST(GenerationSnapshotLoaderTest, RejectsInvalidPaginationWithoutReplacingOldSnapshot) {
  struct InvalidCase {
    const char* name;
    std::function<void(std::vector<generation::Page>&)> mutate;
    std::optional<std::size_t> fail_fetch_at;
  };
  const std::vector<InvalidCase> cases{
      {"generation drift", [](auto& pages) { pages[1].generation_id = kOtherGenerationId; }, std::nullopt},
      {"lease drift", [](auto& pages) { pages[1].lease_id = "lease-2"; }, std::nullopt},
      {"manifest drift", [](auto& pages) { pages[1].manifest.created_at_ms += 1; }, std::nullopt},
      {"content version drift", [](auto& pages) {
         pages[1].manifest.content_version = "sha256:other";
       }, std::nullopt},
      {"diagnostic drift", [](auto& pages) {
         pages[1].manifest.diagnostic = "changed";
       }, std::nullopt},
      {"expired lease", [](auto& pages) { pages[0].expires_at_ms = 1'000; }, std::nullopt},
      {"nonmonotonic lease", [](auto& pages) { pages[1].expires_at_ms = 9'999; }, std::nullopt},
      {"edge order", [](auto& pages) {
         pages[1].edges[0] = generation_edge("a", "a", "edge-3");
       }, std::nullopt},
      {"duplicate edge key", [](auto& pages) {
         pages[1].edges[0] = pages[0].edges.back();
       }, std::nullopt},
      {"cursor mismatch", [](auto& pages) {
         pages[0].next_cursor->after_edge_id = "wrong-edge";
       }, std::nullopt},
      {"cursor generation mismatch", [](auto& pages) {
         pages[0].next_cursor->generation_id = kOtherGenerationId;
       }, std::nullopt},
      {"unfinished page without cursor", [](auto& pages) {
         pages[0].next_cursor = std::nullopt;
       }, std::nullopt},
      {"empty unfinished page", [](auto& pages) {
         pages[0].edges.clear();
       }, std::nullopt},
      {"finished page with cursor", [](auto& pages) {
         pages[1].next_cursor = cursor_for(pages[1].edges.back());
       }, std::nullopt},
      {"edge count exceeded", [](auto& pages) {
         pages[0].manifest.edge_count = 2;
         pages[1].manifest.edge_count = 2;
       }, std::nullopt},
      {"terminal edge count short", [](auto& pages) {
         pages[0].manifest.edge_count = 4;
         pages[1].manifest.edge_count = 4;
       }, std::nullopt},
      {"publish validation", [](auto& pages) {
         pages[1].edges[0].record.decayed_sum = -1.0;
       }, std::nullopt},
      {"canonical content mismatch", [](auto& pages) {
         pages[1].edges[0].record.rollup_signal_counts.like_count = 1.0;
       }, std::nullopt},
      {"continuation fetch failure", [](auto&) {}, 1u},
  };

  for (const auto& test_case : cases) {
    SCOPED_TRACE(test_case.name);
    telegram::graph::core::GraphStore store;
    store.replace_snapshot(
        {snapshot_edge("old-source", "old-target")},
        10,
        "old-snapshot",
        std::chrono::system_clock::time_point{std::chrono::milliseconds(100)});
    telegram::graph::ops::GraphServiceMetrics metrics;
    auto pages = valid_pages();
    test_case.mutate(pages);
    auto source = std::make_shared<FakeGenerationPageSource>(std::move(pages));
    source->fail_fetch_at = test_case.fail_fetch_at;
    telegram::graph::snapshot::GenerationSnapshotLoader loader(
        2,
        10,
        source,
        store,
        metrics,
        fixed_clock());

    EXPECT_THROW(loader.refresh_once(), std::exception);

    EXPECT_EQ(store.metadata().snapshot_version, "old-snapshot");
    ASSERT_EQ(source->releases.size(), 1u);
    EXPECT_EQ(
        source->releases[0],
        std::make_pair(kLoaderGenerationId, std::string("lease-1")));
    const auto refresh = refresh_metrics(metrics, store);
    EXPECT_EQ(refresh.at("successes"), 0);
    EXPECT_EQ(refresh.at("failures"), 1);
  }
}

TEST(GraphStoreGenerationPublishTest, ExternalPinOnlyBypassesLexicalVersionRegression) {
  telegram::graph::core::GraphStore store;
  store.replace_snapshot(
      {snapshot_edge("u1", "old")},
      10,
      "z-version",
      std::chrono::system_clock::time_point{std::chrono::milliseconds(100)});
  auto externally_pinned = telegram::graph::core::snapshot::build_snapshot<
      telegram::graph::core::store::SnapshotData,
      telegram::graph::core::domain::WeightedNeighbor>(
      {snapshot_edge("u1", "new")},
      10,
      "a-version",
      std::chrono::system_clock::time_point{std::chrono::milliseconds(200)},
      telegram::graph::core::query::normalized_weight);

  store.publish_externally_pinned_snapshot(std::move(externally_pinned));

  EXPECT_EQ(store.metadata().snapshot_version, "a-version");
  EXPECT_THROW(
      store.replace_snapshot(
          {snapshot_edge("u1", "regressed")},
          10,
          "0-version",
          std::chrono::system_clock::time_point{std::chrono::milliseconds(300)}),
      std::invalid_argument);
  EXPECT_THROW(store.publish_externally_pinned_snapshot(nullptr), std::invalid_argument);
  EXPECT_EQ(store.metadata().snapshot_version, "a-version");
}

TEST(GraphStoreGenerationPublishTest, ExternalPinRetainsVersionAndLoadedAtValidation) {
  auto missing_version = telegram::graph::core::snapshot::build_snapshot<
      telegram::graph::core::store::SnapshotData,
      telegram::graph::core::domain::WeightedNeighbor>(
      {snapshot_edge("u1", "u2")},
      10,
      "",
      std::chrono::system_clock::time_point{std::chrono::milliseconds(100)},
      telegram::graph::core::query::normalized_weight);
  auto invalid_loaded_at = telegram::graph::core::snapshot::build_snapshot<
      telegram::graph::core::store::SnapshotData,
      telegram::graph::core::domain::WeightedNeighbor>(
      {snapshot_edge("u1", "u2")},
      10,
      "valid-version",
      std::chrono::system_clock::time_point{},
      telegram::graph::core::query::normalized_weight);

  telegram::graph::core::GraphStore store;
  EXPECT_THROW(
      store.publish_externally_pinned_snapshot(std::move(missing_version)),
      std::invalid_argument);
  EXPECT_THROW(
      store.publish_externally_pinned_snapshot(std::move(invalid_loaded_at)),
      std::invalid_argument);
  EXPECT_FALSE(store.metadata().loaded);
}

}  // namespace
