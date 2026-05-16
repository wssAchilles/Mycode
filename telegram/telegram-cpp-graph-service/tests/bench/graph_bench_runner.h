#pragma once

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <numeric>
#include <string>
#include <vector>

namespace telegram::graph::tests::bench {

struct BenchResult {
  std::string name;
  int iterations{0};
  std::uint64_t p50_us{0};
  std::uint64_t p95_us{0};
  std::uint64_t p99_us{0};
  double throughput_qps{0.0};
  std::size_t candidates{0};
  std::size_t available{0};
  std::size_t scanned{0};
  std::size_t visited{0};
  bool budget_exhausted{false};
  std::size_t memory_estimate_bytes{0};
};

inline std::uint64_t percentile(std::vector<std::uint64_t> values, const std::size_t pct) {
  if (values.empty()) {
    return 0;
  }
  std::sort(values.begin(), values.end());
  const auto index = ((values.size() - 1) * std::min<std::size_t>(pct, 100)) / 100;
  return values[index];
}

template <typename Fn>
BenchResult run_bench(const std::string& name, const int iterations, Fn fn) {
  std::vector<std::uint64_t> samples;
  samples.reserve(iterations);
  std::size_t candidate_count = 0;
  std::size_t available_count = 0;
  std::size_t scanned_count = 0;
  std::size_t visited_count = 0;
  bool budget_exhausted = false;

  for (int index = 0; index < iterations; ++index) {
    const auto started = std::chrono::steady_clock::now();
    const auto result = fn();
    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - started);
    samples.push_back(static_cast<std::uint64_t>(elapsed.count()));
    candidate_count = result.candidates.size();
    available_count = result.available_count;
    scanned_count = result.scanned_count;
    visited_count = result.visited_count;
    budget_exhausted = result.budget_exhausted;
  }

  const auto total_us = std::uint64_t{
      std::accumulate(samples.begin(), samples.end(), std::uint64_t{0})};
  const auto throughput = total_us == 0
      ? 0.0
      : (static_cast<double>(iterations) * 1000000.0 / static_cast<double>(total_us));
  return BenchResult{
      .name = name,
      .iterations = iterations,
      .p50_us = percentile(samples, 50),
      .p95_us = percentile(samples, 95),
      .p99_us = percentile(samples, 99),
      .throughput_qps = throughput,
      .candidates = candidate_count,
      .available = available_count,
      .scanned = scanned_count,
      .visited = visited_count,
      .budget_exhausted = budget_exhausted,
  };
}

}  // namespace telegram::graph::tests::bench
