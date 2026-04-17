#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace telegram::graph::config {

struct ServiceConfig {
  std::string bind_host;
  std::uint16_t bind_port;
  std::string backend_snapshot_url;
  std::string internal_token;
  std::uint64_t backend_timeout_ms;
  std::uint64_t snapshot_refresh_secs;
  std::size_t snapshot_page_size;
  double min_edge_score;
  std::size_t max_neighbors_per_user;
  std::size_t max_branching_factor;
  std::size_t default_neighbor_limit;
  std::size_t default_author_limit;
  std::size_t default_overlap_limit;
  std::size_t default_max_depth;
};

ServiceConfig load_from_env();

}  // namespace telegram::graph::config
