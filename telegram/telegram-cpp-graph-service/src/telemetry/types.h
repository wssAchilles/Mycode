#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace telegram::graph::telemetry {

// ---------------------------------------------------------------------------
// Attribute value — mirrors OpenTelemetry's common attribute type.
// ---------------------------------------------------------------------------
using AttributeValue = std::variant<std::string, std::int64_t, double, bool>;
using AttributeMap = std::unordered_map<std::string, AttributeValue>;

// ---------------------------------------------------------------------------
// SpanStatusCode — matches OTel canonical status codes.
// ---------------------------------------------------------------------------
enum class SpanStatusCode : std::uint8_t {
  kUnset = 0,
  kOk = 1,
  kError = 2,
};

// ---------------------------------------------------------------------------
// Metric instrument types.
// ---------------------------------------------------------------------------
enum class InstrumentType : std::uint8_t {
  kCounter,
  kGauge,
  kHistogram,
};

}  // namespace telegram::graph::telemetry
