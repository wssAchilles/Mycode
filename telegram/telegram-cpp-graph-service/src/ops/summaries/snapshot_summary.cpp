#include "ops/summaries/snapshot_summary.h"

#include <cstddef>
#include <string>
#include <unordered_map>

namespace telegram::graph::ops::summaries {
namespace {

nlohmann::json edge_kind_counts_json(const std::unordered_map<std::string, std::size_t>& edge_kind_counts) {
  auto result = nlohmann::json::object();
  for (const auto& [kind, count] : edge_kind_counts) {
    result[kind] = count;
  }
  return result;
}

nlohmann::json build_phase_duration_json(
    const std::unordered_map<std::string, std::uint64_t>& build_phase_duration_ms) {
  auto result = nlohmann::json::object();
  for (const auto& [phase, duration_ms] : build_phase_duration_ms) {
    result[phase] = duration_ms;
  }
  return result;
}

}  // namespace

nlohmann::json snapshot_payload_json(
    const core::SnapshotMetadata& metadata,
    const nlohmann::json& loaded_at,
    const std::uint64_t snapshot_age_secs) {
  return nlohmann::json{
      {"loaded", metadata.loaded},
      {"layoutVersion", metadata.layout_version},
      {"edgeCount", metadata.edge_count},
      {"vertexCount", metadata.vertex_count},
      {"denseVertexCount", metadata.dense_vertex_count},
      {"internedEdgeKindCount", metadata.interned_edge_kind_count},
      {"internerMemoryEstimateBytes", metadata.interner_memory_estimate_bytes},
      {"csrSourceCount", metadata.csr_source_count},
      {"csrNeighborCount", metadata.csr_neighbor_count},
      {"csrMemoryEstimateBytes", metadata.csr_memory_estimate_bytes},
      {"rankedCsrNeighborCount", metadata.ranked_csr_neighbor_count},
      {"rankedCsrMemoryEstimateBytes", metadata.ranked_csr_memory_estimate_bytes},
      {"memoryEstimateBytes", metadata.memory_estimate_bytes},
      {"compactSnapshotEnabled", metadata.compact_snapshot_enabled},
      {"snapshotVersion", metadata.snapshot_version},
      {"snapshotRepresentation", metadata.snapshot_representation},
      {"buildPhaseDurationMs", build_phase_duration_json(metadata.build_phase_duration_ms)},
      {"loadedAt", loaded_at},
      {"snapshotAgeSecs", snapshot_age_secs},
      {"edgeKinds", edge_kind_counts_json(metadata.edge_kind_counts)},
  };
}

nlohmann::json snapshot_summary_fields_json(
    const core::SnapshotMetadata& metadata,
    const std::uint64_t snapshot_age_secs) {
  return nlohmann::json{
      {"snapshotLoaded", metadata.loaded},
      {"layoutVersion", metadata.layout_version},
      {"edgeCount", metadata.edge_count},
      {"vertexCount", metadata.vertex_count},
      {"denseVertexCount", metadata.dense_vertex_count},
      {"internedEdgeKindCount", metadata.interned_edge_kind_count},
      {"internerMemoryEstimateBytes", metadata.interner_memory_estimate_bytes},
      {"csrSourceCount", metadata.csr_source_count},
      {"csrNeighborCount", metadata.csr_neighbor_count},
      {"csrMemoryEstimateBytes", metadata.csr_memory_estimate_bytes},
      {"rankedCsrNeighborCount", metadata.ranked_csr_neighbor_count},
      {"rankedCsrMemoryEstimateBytes", metadata.ranked_csr_memory_estimate_bytes},
      {"memoryEstimateBytes", metadata.memory_estimate_bytes},
      {"compactSnapshotEnabled", metadata.compact_snapshot_enabled},
      {"snapshotVersion", metadata.snapshot_version},
      {"snapshotRepresentation", metadata.snapshot_representation},
      {"buildPhaseDurationMs", build_phase_duration_json(metadata.build_phase_duration_ms)},
      {"snapshotAgeSecs", snapshot_age_secs},
      {"edgeKinds", edge_kind_counts_json(metadata.edge_kind_counts)},
  };
}

}  // namespace telegram::graph::ops::summaries
