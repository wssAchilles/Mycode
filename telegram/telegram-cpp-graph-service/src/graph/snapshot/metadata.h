#pragma once

#include <chrono>
#include <cstddef>
#include <string>
#include <unordered_map>

namespace telegram::graph::core {

struct SnapshotMetadata {
  bool loaded{false};
  std::size_t edge_count{0};
  std::size_t vertex_count{0};
  std::size_t dense_vertex_count{0};
  std::size_t interned_edge_kind_count{0};
  std::size_t interner_memory_estimate_bytes{0};
  std::size_t csr_source_count{0};
  std::size_t csr_neighbor_count{0};
  std::size_t csr_memory_estimate_bytes{0};
  std::size_t ranked_csr_neighbor_count{0};
  std::size_t ranked_csr_memory_estimate_bytes{0};
  std::size_t memory_estimate_bytes{0};
  std::string layout_version;
  std::string snapshot_version;
  std::unordered_map<std::string, std::size_t> edge_kind_counts;
  std::chrono::system_clock::time_point loaded_at{};
};

}  // namespace telegram::graph::core
