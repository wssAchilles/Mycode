#include "snapshot/snapshot_loader.h"

#include <algorithm>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string_view>

#include "graph/query/scoring.h"
#include "graph/snapshot/snapshot_builder.h"
#include "graph/store/snapshot_data.h"

namespace telegram::graph::snapshot {
namespace {

std::int64_t epoch_ms(const std::chrono::system_clock::time_point value) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(value.time_since_epoch()).count();
}

bool bytes_less(const std::string_view left, const std::string_view right) {
  return std::lexicographical_compare(
      left.begin(),
      left.end(),
      right.begin(),
      right.end(),
      [](const char left_byte, const char right_byte) {
        return static_cast<unsigned char>(left_byte) < static_cast<unsigned char>(right_byte);
      });
}

bool edge_key_less(const generation::Edge& left, const generation::Edge& right) {
  if (left.record.source_user_id != right.record.source_user_id) {
    return bytes_less(left.record.source_user_id, right.record.source_user_id);
  }
  if (left.record.target_user_id != right.record.target_user_id) {
    return bytes_less(left.record.target_user_id, right.record.target_user_id);
  }
  return bytes_less(left.edge_id, right.edge_id);
}

class LeaseReleaseGuard {
 public:
  LeaseReleaseGuard(
      std::shared_ptr<const generation::PageSource> source,
      std::string generation_id,
      std::string lease_id)
      : source_(std::move(source)),
        generation_id_(std::move(generation_id)),
        lease_id_(std::move(lease_id)) {}

  ~LeaseReleaseGuard() { release(); }

  LeaseReleaseGuard(const LeaseReleaseGuard&) = delete;
  LeaseReleaseGuard& operator=(const LeaseReleaseGuard&) = delete;

  void release() noexcept {
    if (!pending_) {
      return;
    }
    pending_ = false;
    try {
      source_->release(generation_id_, lease_id_);
    } catch (const std::exception&) {
    }
  }

 private:
  std::shared_ptr<const generation::PageSource> source_;
  std::string generation_id_;
  std::string lease_id_;
  bool pending_{true};
};

void require_unexpired(const std::int64_t expires_at_ms, const std::int64_t now_ms) {
  if (expires_at_ms <= now_ms) {
    throw std::runtime_error("generation lease expired");
  }
}

}  // namespace

SnapshotLoader::SnapshotLoader(
    const config::ServiceConfig& config,
    BackendSnapshotClient client,
    core::GraphStore& store,
    ops::GraphServiceMetrics& metrics)
    : SnapshotLoader(
          config,
          std::make_shared<BackendSnapshotClient>(std::move(client)),
          store,
          metrics) {}

SnapshotLoader::SnapshotLoader(
    const config::ServiceConfig& config,
    std::shared_ptr<const SnapshotPageSource> page_source,
    core::GraphStore& store,
    ops::GraphServiceMetrics& metrics)
    : config_(config),
      page_source_(std::move(page_source)),
      store_(store),
      metrics_(metrics) {}

void SnapshotLoader::refresh_once() {
  const auto started_at = std::chrono::system_clock::now();
  try {
    core::snapshot::SnapshotAssembler<core::store::SnapshotData, core::domain::WeightedNeighbor>
        assembler(config_.snapshot_page_size);
    std::size_t offset = 0;
    std::string snapshot_version;

    while (true) {
      const auto page = page_source_->fetch_page(offset, config_.snapshot_page_size, config_.min_edge_score);
      if (snapshot_version.empty() && !page.snapshot_version.empty()) {
        snapshot_version = page.snapshot_version;
      }
      assembler.ingest_edges(page.edges);

      if (page.done || !page.next_offset.has_value()) {
        break;
      }
      offset = page.next_offset.value();
    }

    const auto completed_at = std::chrono::system_clock::now();
    const auto duration =
        std::chrono::duration_cast<std::chrono::milliseconds>(completed_at - started_at);
    if (snapshot_version.empty()) {
      snapshot_version = std::to_string(
          std::chrono::duration_cast<std::chrono::milliseconds>(completed_at.time_since_epoch()).count());
    }

    auto snapshot = assembler.finish(
        config_.max_neighbors_per_user,
        snapshot_version,
        completed_at,
        core::query::normalized_weight);
    store_.publish_snapshot(std::move(snapshot));
    metrics_.record_refresh_success(store_.metadata(), duration, completed_at);
  } catch (const std::exception& error) {
    const auto completed_at = std::chrono::system_clock::now();
    const auto duration =
        std::chrono::duration_cast<std::chrono::milliseconds>(completed_at - started_at);
    metrics_.record_refresh_failure(error.what(), duration, completed_at);
    throw;
  }
}

GenerationSnapshotLoader::GenerationSnapshotLoader(
    const std::size_t page_size,
    const std::size_t max_neighbors_per_user,
    std::shared_ptr<const generation::PageSource> page_source,
    core::GraphStore& store,
    ops::GraphServiceMetrics& metrics,
    Clock clock)
    : page_size_(page_size),
      max_neighbors_per_user_(max_neighbors_per_user),
      page_source_(std::move(page_source)),
      store_(store),
      metrics_(metrics),
      clock_(std::move(clock)) {
  if (page_size_ == 0 || page_source_ == nullptr || !clock_) {
    throw std::invalid_argument("generation snapshot loader configuration is invalid");
  }
}

void GenerationSnapshotLoader::refresh_once() {
  const auto started_at = clock_();
  try {
    core::snapshot::SnapshotAssembler<core::store::SnapshotData, core::domain::WeightedNeighbor>
        assembler(page_size_);
    auto request = generation::PageRequest{.limit = page_size_};
    std::optional<std::string> generation_id;
    std::optional<std::string> lease_id;
    std::optional<generation::Manifest> manifest;
    std::optional<std::int64_t> expires_at_ms;
    std::optional<generation::Edge> previous_edge;
    std::optional<LeaseReleaseGuard> release_guard;
    generation::CanonicalEdgeHasher canonical_hasher;
    std::size_t edge_count = 0;

    while (true) {
      if (expires_at_ms.has_value()) {
        require_unexpired(expires_at_ms.value(), epoch_ms(clock_()));
      }
      const auto page = page_source_->fetch_page(request);
      if (!release_guard.has_value()) {
        generation_id = page.generation_id;
        lease_id = page.lease_id;
        manifest = page.manifest;
        release_guard.emplace(page_source_, page.generation_id, page.lease_id);
      } else if (page.generation_id != generation_id.value() ||
                 page.lease_id != lease_id.value() ||
                 page.manifest != manifest.value()) {
        throw std::runtime_error("generation page identity drift");
      }

      const auto response_now_ms = epoch_ms(clock_());
      require_unexpired(page.expires_at_ms, response_now_ms);
      if (expires_at_ms.has_value() && page.expires_at_ms < expires_at_ms.value()) {
        throw std::runtime_error("generation lease expiry regressed");
      }
      expires_at_ms = page.expires_at_ms;

      if (page.done && page.next_cursor.has_value()) {
        throw std::runtime_error("finished generation page has cursor");
      }
      if (!page.done && (page.edges.empty() || !page.next_cursor.has_value())) {
        throw std::runtime_error("unfinished generation page requires edges and cursor");
      }

      std::vector<contracts::SnapshotEdgeRecord> records;
      records.reserve(page.edges.size());
      for (const auto& edge : page.edges) {
        if (previous_edge.has_value() && !edge_key_less(previous_edge.value(), edge)) {
          throw std::runtime_error("generation edges are not strictly ordered");
        }
        previous_edge = edge;
        canonical_hasher.update(edge);
        records.push_back(edge.record);
      }
      if (page.edges.size() > manifest->edge_count - std::min(edge_count, manifest->edge_count)) {
        throw std::runtime_error("generation edge count exceeded manifest");
      }
      edge_count += page.edges.size();
      assembler.ingest_edges(records);

      if (page.done) {
        if (edge_count != manifest->edge_count) {
          throw std::runtime_error("generation edge count differs from manifest");
        }
        break;
      }

      const auto expected_cursor = generation::Cursor{
          .generation_id = generation_id.value(),
          .after_source_user_id = page.edges.back().record.source_user_id,
          .after_target_user_id = page.edges.back().record.target_user_id,
          .after_edge_id = page.edges.back().edge_id,
      };
      if (page.next_cursor.value() != expected_cursor) {
        throw std::runtime_error("generation cursor does not match final edge");
      }
      request = generation::PageRequest{
          .limit = page_size_,
          .lease_id = lease_id,
          .cursor = page.next_cursor,
      };
    }

    if (canonical_hasher.finish() != manifest->canonical_sha256) {
      throw std::runtime_error("generation canonical SHA-256 differs from manifest");
    }

    const auto assembled_at = clock_();
    auto snapshot = assembler.finish(
        max_neighbors_per_user_,
        generation_id.value(),
        assembled_at,
        core::query::normalized_weight);
    const auto publish_at = clock_();
    require_unexpired(expires_at_ms.value(), epoch_ms(publish_at));
    store_.publish_externally_pinned_snapshot(std::move(snapshot));
    release_guard->release();
    metrics_.record_refresh_success(
        store_.metadata(),
        std::chrono::duration_cast<std::chrono::milliseconds>(publish_at - started_at),
        publish_at);
  } catch (const std::exception& error) {
    const auto completed_at = clock_();
    metrics_.record_refresh_failure(
        error.what(),
        std::chrono::duration_cast<std::chrono::milliseconds>(completed_at - started_at),
        completed_at);
    throw;
  }
}

}  // namespace telegram::graph::snapshot
