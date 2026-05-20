#pragma once

#include <chrono>
#include <functional>
#include <string>

namespace telegram::graph::telemetry {

/// Minimal span abstraction for tracing graph queries.
/// Can be swapped for OpenTelemetry SDK spans later.
class Span {
 public:
  Span(std::string name, std::string attributes = "")
      : name_(std::move(name)),
        attributes_(std::move(attributes)),
        start_(std::chrono::steady_clock::now()) {}

  ~Span() = default;

  // Non-copyable, movable
  Span(const Span&) = delete;
  Span& operator=(const Span&) = delete;
  Span(Span&&) = default;
  Span& operator=(Span&&) = default;

  void set_attribute(const std::string& key, const std::string& value) {
    if (attributes_.empty()) {
      attributes_ = key + "=" + value;
    } else {
      attributes_ += "," + key + "=" + value;
    }
  }

  void set_status(int code) { status_code_ = code; }

  [[nodiscard]] std::chrono::steady_clock::time_point start_time() const { return start_; }

  [[nodiscard]] std::chrono::milliseconds duration() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start_);
  }

  [[nodiscard]] const std::string& name() const { return name_; }
  [[nodiscard]] const std::string& attributes() const { return attributes_; }
  [[nodiscard]] int status_code() const { return status_code_; }

 private:
  std::string name_;
  std::string attributes_;
  std::chrono::steady_clock::time_point start_;
  int status_code_{0};
};

/// Global tracer that can be configured to emit to different backends.
class Tracer {
 public:
  using SpanCallback = std::function<void(const Span&)>;

  static Tracer& instance() {
    static Tracer tracer;
    return tracer;
  }

  void set_on_span_end(SpanCallback callback) {
    on_span_end_ = std::move(callback);
  }

  [[nodiscard]] Span start_span(std::string name, std::string attributes = "") {
    return Span(std::move(name), std::move(attributes));
  }

  void end_span(Span& span) {
    if (on_span_end_) {
      on_span_end_(span);
    }
  }

 private:
  SpanCallback on_span_end_;
};

/// RAII span guard that automatically ends the span on destruction.
class SpanGuard {
 public:
  explicit SpanGuard(std::string name, std::string attributes = "")
      : span_(Tracer::instance().start_span(std::move(name), std::move(attributes))) {}

  ~SpanGuard() { Tracer::instance().end_span(span_); }

  Span& span() { return span_; }
  const Span& span() const { return span_; }

 private:
  Span span_;
};

}  // namespace telegram::graph::telemetry
