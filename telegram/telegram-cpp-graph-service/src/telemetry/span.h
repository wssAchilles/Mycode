#pragma once

#include <chrono>
#include <memory>
#include <string>
#include <utility>

#include "telemetry/types.h"

namespace telegram::graph::telemetry {

class Tracer;

// ---------------------------------------------------------------------------
// Span — a single unit of work in a trace.
//
// Typical usage:
//   auto span = tracer->start_span("graph.neighbors");
//   span->set_attribute("user_id", user_id);
//   auto result = do_work();
//   if (result.error) span->record_error(result.error);
//   span->set_status(SpanStatusCode::kOk);
//   span->end();
//
// A Span that is destroyed without end() being called will auto-finish with
// whatever status is currently set, so callers don't have to worry about
// exception-safety or early returns.
// ---------------------------------------------------------------------------
class Span : public std::enable_shared_from_this<Span> {
 public:
  virtual ~Span() = default;

  // --- Attribute setters (fluent) -------------------------------------------
  Span& set_attribute(const std::string& key, std::string value) {
    set_attribute_impl(key, std::move(value));
    return *this;
  }
  Span& set_attribute(const std::string& key, std::int64_t value) {
    set_attribute_impl(key, value);
    return *this;
  }
  Span& set_attribute(const std::string& key, double value) {
    set_attribute_impl(key, value);
    return *this;
  }
  Span& set_attribute(const std::string& key, bool value) {
    set_attribute_impl(key, value);
    return *this;
  }
  Span& set_attribute(const std::string& key, std::size_t value) {
    set_attribute_impl(key, static_cast<std::int64_t>(value));
    return *this;
  }

  // --- Status & events ------------------------------------------------------
  virtual void set_status(SpanStatusCode code, const std::string& description = "") = 0;
  virtual void record_error(const std::string& message) = 0;

  // --- Lifecycle ------------------------------------------------------------
  virtual void end() = 0;

  // --- Accessors (for exporters) --------------------------------------------
  [[nodiscard]] virtual std::string name() const = 0;
  [[nodiscard]] virtual AttributeMap attributes() const = 0;
  [[nodiscard]] virtual SpanStatusCode status_code() const = 0;
  [[nodiscard]] virtual std::string status_description() const = 0;
  [[nodiscard]] virtual std::vector<std::string> events() const = 0;
  [[nodiscard]] virtual std::uint64_t start_time_unix_nanos() const = 0;
  [[nodiscard]] virtual std::uint64_t end_time_unix_nanos() const = 0;
  [[nodiscard]] virtual bool is_recording() const = 0;

  // --- Span context (for trace propagation) ---------------------------------
  [[nodiscard]] virtual std::string trace_id() const = 0;
  [[nodiscard]] virtual std::string span_id() const = 0;

 protected:
  virtual void set_attribute_impl(const std::string& key, AttributeValue value) = 0;
};

// ---------------------------------------------------------------------------
// ScopedSpan — RAII wrapper that auto-ends the span on destruction.
//
// Usage:
//   {
//     auto span = tracer->start_scoped_span("operation");
//     span->set_attribute("key", "value");
//     // ... work ...
//   } // span auto-finished here
// ---------------------------------------------------------------------------
class ScopedSpan {
 public:
  explicit ScopedSpan(std::shared_ptr<Span> span) : span_(std::move(span)) {}
  ~ScopedSpan() {
    if (span_ && span_->is_recording()) {
      span_->end();
    }
  }

  ScopedSpan(const ScopedSpan&) = delete;
  ScopedSpan& operator=(const ScopedSpan&) = delete;
  ScopedSpan(ScopedSpan&&) noexcept = default;
  ScopedSpan& operator=(ScopedSpan&&) noexcept = default;

  Span* operator->() const { return span_.get(); }
  Span& operator*() const { return *span_; }
  [[nodiscard]] explicit operator bool() const { return span_ != nullptr; }

 private:
  std::shared_ptr<Span> span_;
};

}  // namespace telegram::graph::telemetry
