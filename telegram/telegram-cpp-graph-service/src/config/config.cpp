#include "config/config.h"

#include <cstdlib>
#include <stdexcept>

namespace telegram::graph::config {
namespace {

std::string read_env(const char* key, const std::string& fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::string(value).empty()) {
    return fallback;
  }
  return std::string(value);
}

std::size_t read_size_env(const char* key, std::size_t fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::string(value).empty()) {
    return fallback;
  }
  return static_cast<std::size_t>(std::stoull(value));
}

std::uint64_t read_u64_env(const char* key, std::uint64_t fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::string(value).empty()) {
    return fallback;
  }
  return static_cast<std::uint64_t>(std::stoull(value));
}

double read_double_env(const char* key, double fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::string(value).empty()) {
    return fallback;
  }
  return std::stod(value);
}

std::pair<std::string, std::uint16_t> parse_bind_addr(const std::string& bind_addr) {
  const auto delimiter = bind_addr.rfind(':');
  if (delimiter == std::string::npos) {
    throw std::runtime_error("GRAPH_KERNEL_BIND_ADDR must look like host:port");
  }

  const auto host = bind_addr.substr(0, delimiter);
  const auto port = static_cast<std::uint16_t>(std::stoul(bind_addr.substr(delimiter + 1)));
  return {host.empty() ? "0.0.0.0" : host, port};
}

}  // namespace

ServiceConfig load_from_env() {
  const auto bind_addr = read_env("GRAPH_KERNEL_BIND_ADDR", "0.0.0.0:4300");
  const auto [bind_host, bind_port] = parse_bind_addr(bind_addr);

  return ServiceConfig{
      .bind_host = bind_host,
      .bind_port = bind_port,
      .backend_snapshot_url = read_env(
          "GRAPH_KERNEL_BACKEND_SNAPSHOT_URL",
          "http://backend:5000/internal/graph-kernel/snapshot"),
      .internal_token = read_env("GRAPH_KERNEL_INTERNAL_TOKEN", read_env("RECOMMENDATION_INTERNAL_TOKEN", "")),
      .backend_timeout_ms = read_u64_env("GRAPH_KERNEL_BACKEND_TIMEOUT_MS", 4000),
      .snapshot_refresh_secs = read_u64_env("GRAPH_KERNEL_SNAPSHOT_REFRESH_SECS", 300),
      .snapshot_page_size = read_size_env("GRAPH_KERNEL_SNAPSHOT_PAGE_SIZE", 1000),
      .min_edge_score = read_double_env("GRAPH_KERNEL_MIN_EDGE_SCORE", 0.05),
      .max_neighbors_per_user = read_size_env("GRAPH_KERNEL_MAX_NEIGHBORS_PER_USER", 128),
      .max_branching_factor = read_size_env("GRAPH_KERNEL_MAX_BRANCHING_FACTOR", 32),
      .default_neighbor_limit = read_size_env("GRAPH_KERNEL_DEFAULT_NEIGHBOR_LIMIT", 40),
      .default_author_limit = read_size_env("GRAPH_KERNEL_DEFAULT_AUTHOR_LIMIT", 40),
      .default_overlap_limit = read_size_env("GRAPH_KERNEL_DEFAULT_OVERLAP_LIMIT", 20),
      .default_max_depth = read_size_env("GRAPH_KERNEL_DEFAULT_MAX_DEPTH", 2),
  };
}

}  // namespace telegram::graph::config
