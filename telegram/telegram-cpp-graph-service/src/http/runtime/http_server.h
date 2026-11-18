#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "http/runtime/runtime_metrics.h"

namespace telegram::graph::http {

struct HttpRequest {
  std::string method;
  std::string path;
  std::string http_version{"HTTP/1.1"};
  std::unordered_map<std::string, std::string> headers;
  std::string body;
};

struct HttpResponse {
  int status_code{200};
  std::string content_type{"application/json"};
  std::string body;
};

struct HttpServerOptions {
  std::size_t max_connections{256};
  std::size_t worker_count{8};
  std::size_t queue_capacity{512};
  std::uint64_t request_timeout_secs{5};
  std::uint64_t keep_alive_timeout_secs{15};
  std::size_t max_keep_alive_requests{64};
  std::size_t max_body_bytes{1024 * 1024};
  std::shared_ptr<HttpRuntimeMetrics> metrics;
};

class HttpServer {
 public:
  using Handler = std::function<HttpResponse(const HttpRequest&)>;

  HttpServer(
      std::string bind_host,
      std::uint16_t bind_port,
      Handler handler,
      HttpServerOptions options = {});
  void serve_forever() const;
  void stop() const noexcept;
  [[nodiscard]] std::uint16_t bound_port() const noexcept;
  static void request_shutdown();
  static void reset_shutdown_for_testing();

 private:
  void serve_accept_loop(int server_fd) const;
  void serve_forever_ipv4() const;
  [[nodiscard]] bool should_stop() const noexcept;
  static std::string reason_phrase(int status_code);
  static std::string trim(const std::string& value);
  static std::string to_lower(std::string value);

  void handle_client(int client_fd, const std::atomic<bool>& worker_stopping) const;
  bool wait_for_idle_request(int client_fd, std::string& prebuffer, const std::atomic<bool>& worker_stopping) const;
  HttpRequest read_request(int client_fd, std::string& prebuffer) const;
  bool write_response(int client_fd, const HttpResponse& response, bool keep_alive, std::size_t remaining_requests) const;
  void reject_overloaded(int client_fd) const;

  std::string bind_host_;
  std::uint16_t bind_port_;
  Handler handler_;
  HttpServerOptions options_;
  mutable std::atomic<int> active_connections_{0};
  mutable std::atomic<bool> stop_requested_{false};
  mutable std::atomic<int> listen_fd_{-1};
  mutable std::atomic<std::uint16_t> bound_port_{0};
};

}  // namespace telegram::graph::http
