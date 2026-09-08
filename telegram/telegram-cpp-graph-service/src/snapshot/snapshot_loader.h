#pragma once

#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "config/config.h"
#include "contracts/types.h"
#include "graph/graph_store.h"
#include "ops/metrics.h"
#include "snapshot/backend_snapshot_client.h"
#include "snapshot/generation_protocol.h"

namespace telegram::graph::snapshot {

class SnapshotRefresher {
 public:
  virtual ~SnapshotRefresher() = default;
  virtual void refresh_once() = 0;
};

class SnapshotLoader final : public SnapshotRefresher {
 public:
  SnapshotLoader(
      const config::ServiceConfig& config,
      BackendSnapshotClient client,
      core::GraphStore& store,
      ops::GraphServiceMetrics& metrics);

  SnapshotLoader(
      const config::ServiceConfig& config,
      std::shared_ptr<const SnapshotPageSource> page_source,
      core::GraphStore& store,
      ops::GraphServiceMetrics& metrics);

  void refresh_once() override;

 private:
  config::ServiceConfig config_;
  std::shared_ptr<const SnapshotPageSource> page_source_;
  core::GraphStore& store_;
  ops::GraphServiceMetrics& metrics_;
};

class GenerationSnapshotLoader final : public SnapshotRefresher {
 public:
  using Clock = std::function<std::chrono::system_clock::time_point()>;

  GenerationSnapshotLoader(
      std::size_t page_size,
      std::size_t max_neighbors_per_user,
      std::shared_ptr<const generation::PageSource> page_source,
      core::GraphStore& store,
      ops::GraphServiceMetrics& metrics,
      Clock clock = [] { return std::chrono::system_clock::now(); });

  void refresh_once() override;

 private:
  std::size_t page_size_;
  std::size_t max_neighbors_per_user_;
  std::shared_ptr<const generation::PageSource> page_source_;
  core::GraphStore& store_;
  ops::GraphServiceMetrics& metrics_;
  Clock clock_;
};

}  // namespace telegram::graph::snapshot
