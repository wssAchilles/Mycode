#include "snapshot/snapshot_loader.h"

#include <sstream>

#include "graph/query/scoring.h"
#include "graph/snapshot/snapshot_builder.h"
#include "graph/store/snapshot_data.h"

namespace telegram::graph::snapshot {

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

}  // namespace telegram::graph::snapshot
