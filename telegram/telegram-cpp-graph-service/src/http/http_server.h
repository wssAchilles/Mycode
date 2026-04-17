#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace telegram::graph::http {

struct HttpRequest {
  std::string method;
  std::string path;
  std::unordered_map<std::string, std::string> headers;
  std::string body;
};

struct HttpResponse {
  int status_code{200};
  std::string content_type{"application/json"};
  std::string body;
};

class HttpServer {
 public:
  using Handler = std::function<HttpResponse(const HttpRequest&)>;

  HttpServer(std::string bind_host, std::uint16_t bind_port, Handler handler);
  void serve_forever() const;

 private:
  static std::string reason_phrase(int status_code);
  static std::string trim(const std::string& value);
  static std::string to_lower(std::string value);

  void handle_client(int client_fd) const;
  HttpRequest read_request(int client_fd) const;
  void write_response(int client_fd, const HttpResponse& response) const;

  std::string bind_host_;
  std::uint16_t bind_port_;
  Handler handler_;
};

}  // namespace telegram::graph::http
