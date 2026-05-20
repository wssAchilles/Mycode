#pragma once

#include <atomic>
#include <string>
#include <unordered_map>

namespace telegram::graph::telemetry {

/// Simple in-memory metrics collector.
/// Can be swapped for Prometheus/OpenTelemetry metrics later.
class MetricsCollector {
 public:
  static MetricsCollector& instance() {
    static MetricsCollector collector;
    return collector;
  }

  void increment_counter(const std::string& name, uint64_t value = 1) {
    counters_[name].fetch_add(value, std::memory_order_relaxed);
  }

  void set_gauge(const std::string& name, double value) {
    gauges_[name].store(value, std::memory_order_relaxed);
  }

  [[nodiscard]] uint64_t get_counter(const std::string& name) const {
    auto it = counters_.find(name);
    return it != counters_.end() ? it->second.load(std::memory_order_relaxed) : 0;
  }

  [[nodiscard]] double get_gauge(const std::string& name) const {
    auto it = gauges_.find(name);
    return it != gauges_.end() ? it->second.load(std::memory_order_relaxed) : 0.0;
  }

  /// Export all metrics as Prometheus text format.
  [[nodiscard]] std::string to_prometheus() const {
    std::string output;
    for (const auto& [name, counter] : counters_) {
      output += "# TYPE " + name + " counter\n";
      output += name + " " + std::to_string(counter.load(std::memory_order_relaxed)) + "\n";
    }
    for (const auto& [name, gauge] : gauges_) {
      output += "# TYPE " + name + " gauge\n";
      output += name + " " + std::to_string(gauge.load(std::memory_order_relaxed)) + "\n";
    }
    return output;
  }

 private:
  std::unordered_map<std::string, std::atomic<uint64_t>> counters_;
  std::unordered_map<std::string, std::atomic<double>> gauges_;
};

}  // namespace telegram::graph::telemetry
