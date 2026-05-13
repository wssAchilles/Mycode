#include <algorithm>
#include <chrono>
#include <cstdint>
#include <functional>
#include <iostream>
#include <numeric>
#include <string>
#include <unordered_set>
#include <vector>

#include "contracts/types.h"
#include "graph/graph_store.h"

namespace {

using telegram::graph::contracts::SnapshotEdgeRecord;
using telegram::graph::core::GraphStore;

SnapshotEdgeRecord edge(const std::string& source, const std::string& target, const double score) {
  SnapshotEdgeRecord record;
  record.source_user_id = source;
  record.target_user_id = target;
  record.decayed_sum = score;
  record.interaction_probability = score;
  record.rollup_signal_counts.reply_count = score * 10.0;
  record.rollup_signal_counts.co_engagement_count = score * 4.0;
  record.rollup_signal_counts.content_affinity_count = score * 3.0;
  record.daily_signal_counts.like_count = score * 2.0;
  record.edge_kinds = {"bench"};
  return record;
}

std::vector<SnapshotEdgeRecord> build_edges() {
  std::vector<SnapshotEdgeRecord> edges;
  edges.reserve(70000);
  for (int index = 0; index < 20000; ++index) {
    const auto score = static_cast<double>((index % 1000) + 1) / 1000.0;
    edges.push_back(edge("u-root", "u-" + std::to_string(index), score));
  }
  for (int source = 0; source < 600; ++source) {
    for (int target = 0; target < 64; ++target) {
      const auto score = static_cast<double>(((source + 1) * (target + 3)) % 997) / 997.0;
      edges.push_back(edge("u-" + std::to_string(source), "hop-" + std::to_string(target), score));
    }
  }
  for (int index = 0; index < 5000; ++index) {
    const auto target = "shared-" + std::to_string(index);
    edges.push_back(edge("u-overlap-a", target, 0.4));
    edges.push_back(edge("u-overlap-b", target, 0.6));
  }
  return edges;
}

std::uint64_t percentile(std::vector<std::uint64_t> values, const std::size_t pct) {
  if (values.empty()) {
    return 0;
  }
  std::sort(values.begin(), values.end());
  const auto index = ((values.size() - 1) * std::min<std::size_t>(pct, 100)) / 100;
  return values[index];
}

template <typename Fn>
void run_bench(const std::string& name, const int iterations, Fn fn) {
  std::vector<std::uint64_t> samples;
  samples.reserve(iterations);
  std::size_t candidate_count = 0;
  std::size_t available_count = 0;

  for (int index = 0; index < iterations; ++index) {
    const auto started = std::chrono::steady_clock::now();
    const auto result = fn();
    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - started);
    samples.push_back(static_cast<std::uint64_t>(elapsed.count()));
    candidate_count = result.candidates.size();
    available_count = result.available_count;
  }

  const auto p50 = percentile(samples, 50);
  const auto p95 = percentile(samples, 95);
  const auto p99 = percentile(samples, 99);
  const auto total_us = std::uint64_t{std::accumulate(samples.begin(), samples.end(), std::uint64_t{0})};
  const auto throughput = total_us == 0 ? 0.0 : (static_cast<double>(iterations) * 1000000.0 / static_cast<double>(total_us));
  std::cout << "BENCH name=" << name
            << " iterations=" << iterations
            << " p50_us=" << p50
            << " p95_us=" << p95
            << " p99_us=" << p99
            << " throughput_qps=" << throughput
            << " candidates=" << candidate_count
            << " available=" << available_count
            << '\n';
}

}  // namespace

int main() {
  const auto edges = build_edges();
  GraphStore store;

  const auto publish_started = std::chrono::steady_clock::now();
  store.replace_snapshot(edges, 20000, "bench", std::chrono::system_clock::now());
  const auto publish_us = std::chrono::duration_cast<std::chrono::microseconds>(
      std::chrono::steady_clock::now() - publish_started);
  std::cout << "BENCH name=snapshot_publish iterations=1 p50_us=" << publish_us.count()
            << " p95_us=" << publish_us.count()
            << " p99_us=" << publish_us.count()
            << " throughput_qps=0 candidates=0 available=" << edges.size() << '\n';

  run_bench("direct_high_degree", 200, [&store]() {
    return store.direct_neighbors("u-root", 40, std::unordered_set<std::string>{});
  });
  run_bench("ranked_topk_high_degree", 200, [&store]() {
    return store.social_neighbors("u-root", 40, std::unordered_set<std::string>{});
  });
  run_bench("multi_hop_budgeted", 100, [&store]() {
    return store.multi_hop_candidates("u-root", 40, 3, 64, 50000, 20000, std::unordered_set<std::string>{}, true);
  });
  run_bench("bridge_budgeted", 100, [&store]() {
    return store.bridge_users("u-root", 40, 3, 64, 50000, 20000, std::unordered_set<std::string>{}, true);
  });
  run_bench("overlap_indexed", 200, [&store]() {
    return store.overlap_candidates("u-overlap-a", "u-overlap-b", 40);
  });

  return 0;
}
