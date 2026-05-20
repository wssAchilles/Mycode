#pragma once

/// Stub gRPC service implementation for GraphKernelService.
/// This is a placeholder that can be filled in when gRPC C++ is integrated.
/// Currently the service uses HTTP/JSON; this header provides the interface
/// for a future gRPC migration.

#include <string>
#include <vector>

namespace telegram::graph::grpc {

struct Edge {
  std::string source_user_id;
  std::string target_user_id;
  double score;
  std::vector<std::string> edge_kinds;
  int64_t last_interaction_ts;
};

struct NeighborCandidate {
  std::string user_id;
  double score;
  std::vector<std::string> relation_kinds;
  std::vector<std::string> via_user_ids;
};

struct QueryDiagnostics {
  std::string kernel;
  uint64_t query_duration_ms;
  uint32_t candidate_count;
  uint32_t requested_limit;
  uint32_t available_count;
  bool empty;
  std::string empty_reason;
};

/// Interface for the gRPC service (to be implemented with actual gRPC bindings)
class GraphServiceInterface {
 public:
  virtual ~GraphServiceInterface() = default;

  struct HealthResponse {
    bool ok;
    std::string service;
    bool snapshot_loaded;
    int64_t edge_count;
  };

  struct NeighborResponse {
    std::vector<NeighborCandidate> candidates;
    uint32_t available_count;
    bool budget_exhausted;
    QueryDiagnostics diagnostics;
  };

  virtual HealthResponse health_check() = 0;
  virtual NeighborResponse get_neighbors(const std::string& user_id, uint32_t limit,
                                          const std::vector<std::string>& exclude_ids) = 0;
};

}  // namespace telegram::graph::grpc
