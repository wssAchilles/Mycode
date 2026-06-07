#include "config/config.h"

#include <cstdlib>
#include <iostream>
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
  try {
    return static_cast<std::size_t>(std::stoull(value));
  } catch (const std::exception&) {
    std::cerr << "[config] warning: " << key << "=\"" << value << "\" is not a valid number, using default " << fallback << std::endl;
    return fallback;
  }
}

std::uint64_t read_u64_env(const char* key, std::uint64_t fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::string(value).empty()) {
    return fallback;
  }
  try {
    return static_cast<std::uint64_t>(std::stoull(value));
  } catch (const std::exception&) {
    std::cerr << "[config] warning: " << key << "=\"" << value << "\" is not a valid number, using default " << fallback << std::endl;
    return fallback;
  }
}

double read_double_env(const char* key, double fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || std::string(value).empty()) {
    return fallback;
  }
  try {
    return std::stod(value);
  } catch (const std::exception&) {
    std::cerr << "[config] warning: " << key << "=\"" << value << "\" is not a valid number, using default " << fallback << std::endl;
    return fallback;
  }
}

bool read_bool_env(const char* key, bool fallback) {
  const auto value = read_env(key, "");
  if (value.empty()) {
    return fallback;
  }
  return value == "1" || value == "true" || value == "TRUE" || value == "yes" || value == "on";
}

std::pair<std::string, std::uint16_t> parse_bind_addr(const std::string& bind_addr) {
  std::string host;
  std::uint16_t port;

  if (!bind_addr.empty() && bind_addr.front() == '[') {
    // IPv6 bracketed format: [::1]:port or [::1]:4300
    const auto close_bracket = bind_addr.find(']');
    if (close_bracket == std::string::npos) {
      throw std::runtime_error("GRAPH_KERNEL_BIND_ADDR: missing closing bracket for IPv6");
    }
    host = bind_addr.substr(1, close_bracket - 1);
    if (close_bracket + 1 >= bind_addr.size() || bind_addr[close_bracket + 1] != ':') {
      throw std::runtime_error("GRAPH_KERNEL_BIND_ADDR: missing port after IPv6 bracket");
    }
    port = static_cast<std::uint16_t>(std::stoul(bind_addr.substr(close_bracket + 2)));
  } else {
    // IPv4 format: host:port
    const auto delimiter = bind_addr.rfind(':');
    if (delimiter == std::string::npos) {
      throw std::runtime_error("GRAPH_KERNEL_BIND_ADDR must look like host:port");
    }
    host = bind_addr.substr(0, delimiter);
    port = static_cast<std::uint16_t>(std::stoul(bind_addr.substr(delimiter + 1)));
  }

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
      .max_query_limit = read_size_env("GRAPH_KERNEL_MAX_QUERY_LIMIT", 200),
      .max_query_depth = read_size_env("GRAPH_KERNEL_MAX_QUERY_DEPTH", 3),
      .max_multi_hop_visited = read_size_env("GRAPH_KERNEL_MAX_MULTI_HOP_VISITED", 50000),
      .max_multi_hop_candidates = read_size_env("GRAPH_KERNEL_MAX_MULTI_HOP_CANDIDATES", 20000),
      .traversal_best_first_enabled = read_bool_env("GRAPH_KERNEL_TRAVERSAL_BEST_FIRST_ENABLED", false),
      .overlap_streaming_topk_enabled = read_bool_env("GRAPH_KERNEL_OVERLAP_STREAMING_TOPK_ENABLED", true),
      .http_max_connections = read_size_env("GRAPH_KERNEL_HTTP_MAX_CONNECTIONS", 256),
      .http_worker_count = read_size_env("GRAPH_KERNEL_HTTP_WORKER_COUNT", 8),
      .http_queue_capacity = read_size_env("GRAPH_KERNEL_HTTP_QUEUE_CAPACITY", 512),
      .http_request_timeout_secs = read_u64_env("GRAPH_KERNEL_HTTP_REQUEST_TIMEOUT_SECS", 5),
      .http_max_body_bytes = read_size_env("GRAPH_KERNEL_HTTP_MAX_BODY_BYTES", 1024 * 1024),
  };
}

}  // namespace telegram::graph::config
