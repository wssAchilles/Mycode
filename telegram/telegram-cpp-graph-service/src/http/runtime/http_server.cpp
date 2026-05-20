#include "http/runtime/http_server.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <condition_variable>
#include <cstring>
#include <cerrno>
#include <deque>
#include <iostream>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

namespace {
std::atomic<bool> g_shutdown_requested{false};
}  // namespace

namespace telegram::graph::http {
namespace {

constexpr std::size_t kBufferSize = 8192;

class HttpReadError : public std::runtime_error {
 public:
  HttpReadError(const int status_code, std::string code, std::string message)
      : std::runtime_error(message),
        status_code(status_code),
        code(std::move(code)),
        message(std::move(message)) {}

  int status_code;
  std::string code;
  std::string message;
};

HttpResponse error_response(const int status_code, const std::string& code, const std::string& message) {
  return HttpResponse{
      .status_code = status_code,
      .body = "{\"success\":false,\"error\":{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}}",
  };
}

}  // namespace

HttpServer::HttpServer(
    std::string bind_host,
    const std::uint16_t bind_port,
    Handler handler,
    HttpServerOptions options)
    : bind_host_(std::move(bind_host)),
      bind_port_(bind_port),
      handler_(std::move(handler)),
      options_(options) {
  if (options_.worker_count == 0) {
    options_.worker_count = 1;
  }
  if (options_.queue_capacity == 0) {
    options_.queue_capacity = options_.worker_count;
  }
  if (options_.max_connections == 0) {
    options_.max_connections = options_.worker_count;
  }
  if (options_.max_body_bytes == 0) {
    options_.max_body_bytes = 1024 * 1024;
  }
  if (options_.request_timeout_secs == 0) {
    options_.request_timeout_secs = 5;
  }
}

void HttpServer::request_shutdown() {
  g_shutdown_requested.store(true, std::memory_order_release);
}

void HttpServer::serve_forever() const {
  // Dual-stack: use AF_INET6 with IPV6_V6ONLY=0 to accept both IPv4 and IPv6
  const auto server_fd = ::socket(AF_INET6, SOCK_STREAM, 0);
  if (server_fd < 0) {
    // Fallback to IPv4-only if IPv6 is not available
    return serve_forever_ipv4();
  }

  int option = 1;
  ::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &option, sizeof(option));

  // Allow dual-stack (IPv4 + IPv6) on a single socket
  int v6only = 0;
  if (::setsockopt(server_fd, IPPROTO_IPV6, IPV6_V6ONLY, &v6only, sizeof(v6only)) < 0) {
    ::close(server_fd);
    return serve_forever_ipv4();
  }

  sockaddr_in6 address{};
  address.sin6_family = AF_INET6;
  address.sin6_port = htons(bind_port_);
  address.sin6_addr = in6addr_any;
  if (bind_host_ != "0.0.0.0" && bind_host_ != "::") {
    if (::inet_pton(AF_INET6, bind_host_.c_str(), &address.sin6_addr) <= 0) {
      // Try IPv4-mapped address
      ::close(server_fd);
      return serve_forever_ipv4();
    }
  }

  if (::bind(server_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
    ::close(server_fd);
    return serve_forever_ipv4();
  }

  if (::listen(server_fd, SOMAXCONN) < 0) {
    ::close(server_fd);
    throw std::runtime_error("listen on socket");
  }

  std::deque<int> work_queue;
  std::mutex queue_mutex;
  std::condition_variable queue_cv;
  std::vector<std::jthread> workers;
  workers.reserve(options_.worker_count);
  for (std::size_t index = 0; index < options_.worker_count; ++index) {
    workers.emplace_back([this, &work_queue, &queue_mutex, &queue_cv]() {
      while (true) {
        int client_fd = -1;
        {
          std::unique_lock lock(queue_mutex);
          queue_cv.wait(lock, [&work_queue]() { return !work_queue.empty(); });
          client_fd = work_queue.front();
          work_queue.pop_front();
          if (options_.metrics != nullptr) {
            options_.metrics->set_queue_depth(work_queue.size());
          }
        }
        if (options_.metrics != nullptr) {
          options_.metrics->worker_started();
        }
        handle_client(client_fd);
        if (options_.metrics != nullptr) {
          options_.metrics->worker_finished();
        }
        const auto active_connections = active_connections_.fetch_sub(1, std::memory_order_relaxed) - 1;
        if (options_.metrics != nullptr) {
          options_.metrics->set_active_connections(static_cast<std::size_t>(std::max(0, active_connections)));
        }
      }
    });
  }

  // Graceful shutdown: install signal handlers
  struct sigaction sa{};
  sa.sa_handler = [](int) { g_shutdown_requested.store(true, std::memory_order_release); };
  sigemptyset(&sa.sa_mask);
  ::sigaction(SIGTERM, &sa, nullptr);
  ::sigaction(SIGINT, &sa, nullptr);

  while (!g_shutdown_requested.load(std::memory_order_acquire)) {
    sockaddr_storage client_address{};
    socklen_t client_length = sizeof(client_address);
    const auto client_fd =
        ::accept(server_fd, reinterpret_cast<sockaddr*>(&client_address), &client_length);
    if (client_fd < 0) {
      if (g_shutdown_requested.load(std::memory_order_acquire)) break;
      continue;
    }
    if (options_.metrics != nullptr) {
      options_.metrics->record_accept();
    }

    if (active_connections_.load(std::memory_order_relaxed) >= static_cast<int>(options_.max_connections)) {
      reject_overloaded(client_fd);
      continue;
    }

    bool enqueued = false;
    {
      std::lock_guard lock(queue_mutex);
      if (work_queue.size() < options_.queue_capacity) {
        const auto active_connections = active_connections_.fetch_add(1, std::memory_order_relaxed) + 1;
        if (options_.metrics != nullptr) {
          options_.metrics->set_active_connections(static_cast<std::size_t>(active_connections));
        }
        work_queue.push_back(client_fd);
        if (options_.metrics != nullptr) {
          options_.metrics->set_queue_depth(work_queue.size());
        }
        enqueued = true;
      }
    }
    if (!enqueued) {
      reject_overloaded(client_fd);
      continue;
    }
    queue_cv.notify_one();
  }

  // Graceful shutdown: close server socket and drain work queue
  ::close(server_fd);
  std::cout << "[http] shutdown requested, draining connections..." << std::endl;
}

void HttpServer::serve_forever_ipv4() const {
  const auto server_fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (server_fd < 0) {
    throw std::runtime_error("create listen socket");
  }

  int option = 1;
  ::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &option, sizeof(option));

  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(bind_port_);
  if (::inet_pton(AF_INET, bind_host_.c_str(), &address.sin_addr) <= 0) {
    ::close(server_fd);
    throw std::runtime_error("parse bind host");
  }

  if (::bind(server_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
    ::close(server_fd);
    throw std::runtime_error("bind listen socket");
  }

  if (::listen(server_fd, SOMAXCONN) < 0) {
    ::close(server_fd);
    throw std::runtime_error("listen on socket");
  }

  std::deque<int> work_queue;
  std::mutex queue_mutex;
  std::condition_variable queue_cv;
  std::vector<std::jthread> workers;
  workers.reserve(options_.worker_count);
  for (std::size_t index = 0; index < options_.worker_count; ++index) {
    workers.emplace_back([this, &work_queue, &queue_mutex, &queue_cv]() {
      while (true) {
        int client_fd = -1;
        {
          std::unique_lock lock(queue_mutex);
          queue_cv.wait(lock, [&work_queue]() { return !work_queue.empty(); });
          client_fd = work_queue.front();
          work_queue.pop_front();
          if (options_.metrics != nullptr) {
            options_.metrics->set_queue_depth(work_queue.size());
          }
        }
        if (options_.metrics != nullptr) {
          options_.metrics->worker_started();
        }
        handle_client(client_fd);
        if (options_.metrics != nullptr) {
          options_.metrics->worker_finished();
        }
        const auto active_connections = active_connections_.fetch_sub(1, std::memory_order_relaxed) - 1;
        if (options_.metrics != nullptr) {
          options_.metrics->set_active_connections(static_cast<std::size_t>(std::max(0, active_connections)));
        }
      }
    });
  }

  while (!g_shutdown_requested.load(std::memory_order_acquire)) {
    sockaddr_in client_address{};
    socklen_t client_length = sizeof(client_address);
    const auto client_fd =
        ::accept(server_fd, reinterpret_cast<sockaddr*>(&client_address), &client_length);
    if (client_fd < 0) {
      if (g_shutdown_requested.load(std::memory_order_acquire)) break;
      continue;
    }
    if (options_.metrics != nullptr) {
      options_.metrics->record_accept();
    }

    if (active_connections_.load(std::memory_order_relaxed) >= static_cast<int>(options_.max_connections)) {
      reject_overloaded(client_fd);
      continue;
    }

    bool enqueued = false;
    {
      std::lock_guard lock(queue_mutex);
      if (work_queue.size() < options_.queue_capacity) {
        const auto active_connections = active_connections_.fetch_add(1, std::memory_order_relaxed) + 1;
        if (options_.metrics != nullptr) {
          options_.metrics->set_active_connections(static_cast<std::size_t>(active_connections));
        }
        work_queue.push_back(client_fd);
        if (options_.metrics != nullptr) {
          options_.metrics->set_queue_depth(work_queue.size());
        }
        enqueued = true;
      }
    }
    if (!enqueued) {
      reject_overloaded(client_fd);
      continue;
    }
    queue_cv.notify_one();
  }

  ::close(server_fd);
  std::cout << "[http] shutdown requested, draining connections..." << std::endl;
}

void HttpServer::handle_client(const int client_fd) const {
  struct timeval recv_timeout{};
  recv_timeout.tv_sec = static_cast<decltype(recv_timeout.tv_sec)>(options_.request_timeout_secs);
  recv_timeout.tv_usec = 0;
  ::setsockopt(client_fd, SOL_SOCKET, SO_RCVTIMEO, &recv_timeout, sizeof(recv_timeout));

  try {
    const auto request = read_request(client_fd);
    const auto response = handler_(request);
    write_response(client_fd, response);
  } catch (const HttpReadError& error) {
    if (options_.metrics != nullptr) {
      options_.metrics->record_read_error(error.status_code);
    }
    write_response(client_fd, error_response(error.status_code, error.code, error.message));
  } catch (const std::exception& error) {
    if (options_.metrics != nullptr) {
      options_.metrics->record_read_error(500);
    }
    std::cerr << "[http] handler error: " << error.what() << std::endl;
    const auto response = HttpResponse{
        .status_code = 500,
        .body = "{\"success\":false,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"internal server error\"}}",
    };
    write_response(client_fd, response);
  }
  ::close(client_fd);
}

HttpRequest HttpServer::read_request(const int client_fd) const {
  std::string raw_request;
  char buffer[kBufferSize];
  while (raw_request.find("\r\n\r\n") == std::string::npos) {
    errno = 0;
    const auto received = ::recv(client_fd, buffer, sizeof(buffer), 0);
    if (received <= 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        throw HttpReadError(408, "REQUEST_TIMEOUT", "request timed out while reading headers");
      }
      throw HttpReadError(400, "INVALID_REQUEST", "failed to read request headers");
    }
    raw_request.append(buffer, received);
    if (raw_request.size() > options_.max_body_bytes) {
      throw HttpReadError(413, "REQUEST_TOO_LARGE", "request exceeds maximum size");
    }
  }

  const auto header_end = raw_request.find("\r\n\r\n");
  const auto headers_block = raw_request.substr(0, header_end);
  auto body = raw_request.substr(header_end + 4);

  std::istringstream stream(headers_block);
  std::string request_line;
  std::getline(stream, request_line);
  if (!request_line.empty() && request_line.back() == '\r') {
    request_line.pop_back();
  }

  std::istringstream request_line_stream(request_line);
  HttpRequest request;
  request_line_stream >> request.method >> request.path;
  std::string version;
  request_line_stream >> version;

  std::string header_line;
  std::size_t content_length = 0;
  while (std::getline(stream, header_line)) {
    if (!header_line.empty() && header_line.back() == '\r') {
      header_line.pop_back();
    }
    const auto delimiter = header_line.find(':');
    if (delimiter == std::string::npos) {
      continue;
    }
    const auto key = to_lower(trim(header_line.substr(0, delimiter)));
    const auto value = trim(header_line.substr(delimiter + 1));
    request.headers[key] = value;
    if (key == "content-length") {
      try {
        content_length = static_cast<std::size_t>(std::stoull(value));
      } catch (const std::exception&) {
        throw HttpReadError(400, "INVALID_REQUEST", "invalid content-length");
      }
      if (content_length > options_.max_body_bytes) {
        throw HttpReadError(413, "REQUEST_TOO_LARGE", "content-length exceeds maximum");
      }
    }
  }

  while (body.size() < content_length) {
    errno = 0;
    const auto received = ::recv(client_fd, buffer, sizeof(buffer), 0);
    if (received <= 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        throw HttpReadError(408, "REQUEST_TIMEOUT", "request timed out while reading body");
      }
      throw HttpReadError(400, "INVALID_REQUEST", "failed to read request body");
    }
    body.append(buffer, received);
  }

  request.body = body.substr(0, content_length);
  const auto query_delimiter = request.path.find('?');
  if (query_delimiter != std::string::npos) {
    request.path = request.path.substr(0, query_delimiter);
  }
  return request;
}

void HttpServer::reject_overloaded(const int client_fd) const {
  if (options_.metrics != nullptr) {
    options_.metrics->record_reject();
  }
  write_response(
      client_fd,
      error_response(503, "SERVER_OVERLOADED", "server is overloaded"));
  ::close(client_fd);
}

void HttpServer::write_response(const int client_fd, const HttpResponse& response) const {
  std::ostringstream stream;
  stream << "HTTP/1.1 " << response.status_code << ' ' << reason_phrase(response.status_code) << "\r\n";
  stream << "Content-Type: " << response.content_type << "\r\n";
  stream << "Content-Length: " << response.body.size() << "\r\n";
  stream << "Connection: keep-alive\r\n\r\n";
  stream << response.body;
  const auto wire = stream.str();

  std::size_t written = 0;
  while (written < wire.size()) {
    const auto sent =
        ::send(client_fd, wire.data() + written, wire.size() - written, MSG_NOSIGNAL);
    if (sent <= 0) {
      break;
    }
    written += static_cast<std::size_t>(sent);
  }
}

std::string HttpServer::reason_phrase(const int status_code) {
  switch (status_code) {
    case 200:
      return "OK";
    case 400:
      return "Bad Request";
    case 404:
      return "Not Found";
    case 405:
      return "Method Not Allowed";
    case 408:
      return "Request Timeout";
    case 413:
      return "Payload Too Large";
    case 503:
      return "Service Unavailable";
    default:
      return "Internal Server Error";
  }
}

std::string HttpServer::trim(const std::string& value) {
  const auto start = value.find_first_not_of(" \t");
  if (start == std::string::npos) {
    return "";
  }
  const auto end = value.find_last_not_of(" \t");
  return value.substr(start, end - start + 1);
}

std::string HttpServer::to_lower(std::string value) {
  for (auto& character : value) {
    character = static_cast<char>(std::tolower(character));
  }
  return value;
}

}  // namespace telegram::graph::http
