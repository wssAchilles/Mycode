#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>

#include "telemetry/types.h"

namespace telegram::graph::telemetry {

// ---------------------------------------------------------------------------
// Metric instrument interfaces.
// ---------------------------------------------------------------------------

class Counter {
 public:
  virtual ~Counter() = default;
  virtual void add(double value, const AttributeMap& attrs = {}) = 0;
  virtual void add(std::int64_t value, const AttributeMap& attrs = {}) = 0;
  [[nodiscard]] virtual std::string name() const = 0;
  [[nodiscard]] virtual std::string unit() const = 0;
};

class Gauge {
 public:
  virtual ~Gauge() = default;
  virtual void set(double value, const AttributeMap& attrs = {}) = 0;
  virtual void set(std::int64_t value, const AttributeMap& attrs = {}) = 0;
  [[nodiscard]] virtual std::string name() const = 0;
  [[nodiscard]] virtual std::string unit() const = 0;
};

class Histogram {
 public:
  virtual ~Histogram() = default;
  virtual void record(double value, const AttributeMap& attrs = {}) = 0;
  virtual void record(std::int64_t value, const AttributeMap& attrs = {}) = 0;
  [[nodiscard]] virtual std::string name() const = 0;
  [[nodiscard]] virtual std::string unit() const = 0;
};

// ---------------------------------------------------------------------------
// Meter — creates metric instruments for a named instrumentation scope.
// ---------------------------------------------------------------------------
class Meter {
 public:
  virtual ~Meter() = default;

  [[nodiscard]] virtual std::shared_ptr<Counter> create_counter(
      const std::string& name,
      const std::string& unit = "",
      const std::string& description = "") = 0;

  [[nodiscard]] virtual std::shared_ptr<Gauge> create_gauge(
      const std::string& name,
      const std::string& unit = "",
      const std::string& description = "") = 0;

  [[nodiscard]] virtual std::shared_ptr<Histogram> create_histogram(
      const std::string& name,
      const std::string& unit = "",
      const std::string& description = "") = 0;
};

}  // namespace telegram::graph::telemetry
