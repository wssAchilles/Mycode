#include "snapshot/snapshot_loader.h"

#include <sstream>

namespace telegram::graph::snapshot {

SnapshotLoader::SnapshotLoader(
    const config::ServiceConfig& config,
    BackendSnapshotClient client,
    core::GraphStore& store,
    ops::GraphServiceMetrics& metrics)
    : config_(config),
      client_(std::move(client)),
      store_(store),
      metrics_(metrics) {}

void SnapshotLoader::refresh_once() {
  const auto started_at = std::chrono::system_clock::now();
  try {
    std::vector<contracts::SnapshotEdgeRecord> edges;
    std::size_t offset = 0;

    while (true) {
      const auto page = client_.fetch_page(offset, config_.snapshot_page_size, config_.min_edge_score);
      edges.insert(edges.end(), page.edges.begin(), page.edges.end());

      if (page.done || !page.next_offset.has_value()) {
        break;
      }
      offset = page.next_offset.value();
    }

    const auto completed_at = std::chrono::system_clock::now();
    const auto duration =
        std::chrono::duration_cast<std::chrono::milliseconds>(completed_at - started_at);
    const auto snapshot_version =
        std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                           completed_at.time_since_epoch())
                           .count());

    store_.replace_snapshot(edges, config_.max_neighbors_per_user, snapshot_version, completed_at);
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
