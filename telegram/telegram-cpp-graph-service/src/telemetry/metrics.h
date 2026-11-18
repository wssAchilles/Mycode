#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>

namespace telegram::graph::telemetry {

/// 线程安全的内存指标收集器，供 Prometheus 文本端点安全导出
class MetricsCollector {
 public:
  static MetricsCollector& instance() {
    static MetricsCollector collector;
    return collector;
  }

  void increment_counter(const std::string& name, uint64_t value = 1) {
    std::lock_guard<std::mutex> lock(mutex_);
    counters_[name].fetch_add(value, std::memory_order_relaxed);
  }

  void set_gauge(const std::string& name, double value) {
    std::lock_guard<std::mutex> lock(mutex_);
    gauges_[name].store(value, std::memory_order_relaxed);
  }

  [[nodiscard]] uint64_t get_counter(const std::string& name) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = counters_.find(name);
    return it != counters_.end() ? it->second.load(std::memory_order_relaxed) : 0;
  }

  [[nodiscard]] double get_gauge(const std::string& name) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = gauges_.find(name);
    return it != gauges_.end() ? it->second.load(std::memory_order_relaxed) : 0.0;
  }

  /// 将全部计数器与仪表值导出为 Prometheus 文本格式
  [[nodiscard]] std::string to_prometheus() const {
    std::lock_guard<std::mutex> lock(mutex_);
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
  mutable std::mutex mutex_;
  std::unordered_map<std::string, std::atomic<uint64_t>> counters_;
  std::unordered_map<std::string, std::atomic<double>> gauges_;
};

}  // namespace telegram::graph::telemetry
