#include <chrono>
#include <cstdint>
#include <iostream>
#include <string>
#include <unordered_set>
#include <vector>

#include "bench/graph_bench_dataset.h"
#include "bench/graph_bench_runner.h"
#include "bench/graph_bench_schema.h"
#include "graph/graph_store.h"

namespace {

using telegram::graph::core::GraphStore;
using telegram::graph::tests::bench::BenchResult;
using telegram::graph::tests::bench::build_edges;
using telegram::graph::tests::bench::build_json_payload;
using telegram::graph::tests::bench::print_text_result;
using telegram::graph::tests::bench::run_bench;

}  // namespace

int main(int argc, char** argv) {
  const bool json_output = argc > 1 && std::string(argv[1]) == "--json";
  const auto edges = build_edges();
  GraphStore store;
  std::vector<BenchResult> results;

  const auto publish_started = std::chrono::steady_clock::now();
  store.replace_snapshot(edges, 20000, "bench", std::chrono::system_clock::now());
  const auto publish_us = std::chrono::duration_cast<std::chrono::microseconds>(
      std::chrono::steady_clock::now() - publish_started);
  const auto metadata = store.metadata();
  results.push_back(BenchResult{
      .name = "snapshot_publish",
      .iterations = 1,
      .p50_us = static_cast<std::uint64_t>(publish_us.count()),
      .p95_us = static_cast<std::uint64_t>(publish_us.count()),
      .p99_us = static_cast<std::uint64_t>(publish_us.count()),
      .throughput_qps = 0.0,
      .candidates = 0,
      .available = edges.size(),
      .memory_estimate_bytes = metadata.memory_estimate_bytes,
  });

  results.push_back(run_bench("direct_high_degree", 200, [&store]() {
    return store.direct_neighbors("u-root", 40, std::unordered_set<std::string>{});
  }));
  results.push_back(run_bench("ranked_topk_high_degree", 200, [&store]() {
    return store.social_neighbors("u-root", 40, std::unordered_set<std::string>{});
  }));
  results.push_back(run_bench("multi_hop_budgeted", 100, [&store]() {
    return store.multi_hop_candidates(
        "u-root",
        40,
        3,
        64,
        50000,
        20000,
        std::unordered_set<std::string>{},
        true);
  }));
  results.push_back(run_bench("bridge_budgeted", 100, [&store]() {
    return store.bridge_users(
        "u-root",
        40,
        3,
        64,
        50000,
        20000,
        std::unordered_set<std::string>{},
        true);
  }));
  results.push_back(run_bench("overlap_indexed", 200, [&store]() {
    return store.overlap_candidates("u-overlap-a", "u-overlap-b", 40);
  }));

  for (auto& result : results) {
    if (result.memory_estimate_bytes == 0) {
      result.memory_estimate_bytes = metadata.memory_estimate_bytes;
    }
  }

  if (json_output) {
    std::cout << build_json_payload(results, edges.size(), metadata).dump(2) << '\n';
    return 0;
  }

  for (const auto& result : results) {
    print_text_result(result);
  }

  return 0;
}
