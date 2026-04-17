#pragma once

#include <chrono>
#include <string>
#include <vector>

#include "config/config.h"
#include "contracts/types.h"
#include "graph/graph_store.h"
#include "ops/metrics.h"
#include "snapshot/backend_snapshot_client.h"

namespace telegram::graph::snapshot {

class SnapshotLoader {
 public:
  SnapshotLoader(
      const config::ServiceConfig& config,
      BackendSnapshotClient client,
      core::GraphStore& store,
      ops::GraphServiceMetrics& metrics);

  void refresh_once();

 private:
  config::ServiceConfig config_;
  BackendSnapshotClient client_;
  core::GraphStore& store_;
  ops::GraphServiceMetrics& metrics_;
};

}  // namespace telegram::graph::snapshot
