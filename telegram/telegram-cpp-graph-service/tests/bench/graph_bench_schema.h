#pragma once

#include <algorithm>
#include <cstddef>
#include <iostream>
#include <vector>

#include <nlohmann/json.hpp>

#include "graph_bench_runner.h"
#include "graph/snapshot/metadata.h"

namespace telegram::graph::tests::bench {

inline void print_text_result(const BenchResult& result) {
  std::cout << "BENCH name=" << result.name
            << " iterations=" << result.iterations
            << " p50_us=" << result.p50_us
            << " p95_us=" << result.p95_us
            << " p99_us=" << result.p99_us
            << " throughput_qps=" << result.throughput_qps
            << " candidates=" << result.candidates
            << " available=" << result.available
            << " scanned=" << result.scanned
            << " visited=" << result.visited
            << " budget_exhausted=" << (result.budget_exhausted ? 1 : 0)
            << " memory_estimate_bytes=" << result.memory_estimate_bytes
            << '\n';
}

inline nlohmann::json to_json(const BenchResult& result) {
  return nlohmann::json{
      {"name", result.name},
      {"iterations", result.iterations},
      {"p50_us", result.p50_us},
      {"p95_us", result.p95_us},
      {"p99_us", result.p99_us},
      {"throughput_qps", result.throughput_qps},
      {"candidates", result.candidates},
      {"available", result.available},
      {"scanned", result.scanned},
      {"visited", result.visited},
      {"budget_exhausted", result.budget_exhausted},
      {"memory_estimate_bytes", result.memory_estimate_bytes},
  };
}

inline nlohmann::json build_json_payload(
    const std::vector<BenchResult>& results,
    const std::size_t edge_count,
    const core::SnapshotMetadata& metadata) {
  nlohmann::json result_items = nlohmann::json::array();
  for (const auto& result : results) {
    result_items.push_back(to_json(result));
  }
  const auto snapshot_result =
      std::find_if(results.begin(), results.end(), [](const BenchResult& result) {
        return result.name == "snapshot_publish";
      });
  return nlohmann::json{
      {"schemaVersion", "graph_store_bench_v2"},
      {"suite", "synthetic_graph_store"},
      {"graphShape",
       {
           {"edgeCount", edge_count},
           {"sourceCount", metadata.csr_source_count},
           {"neighborCount", metadata.csr_neighbor_count},
           {"memoryEstimateBytes", metadata.memory_estimate_bytes},
       }},
      {"summary",
       {
           {"snapshotPublishUs", snapshot_result == results.end() ? 0 : snapshot_result->p50_us},
           {"memoryEstimateBytes", metadata.memory_estimate_bytes},
           {"resultCount", results.size()},
       }},
      {"results", result_items},
  };
}

}  // namespace telegram::graph::tests::bench
