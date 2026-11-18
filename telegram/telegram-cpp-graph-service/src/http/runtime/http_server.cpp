#include "http/runtime/http_server.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cerrno>
#include <cstring>
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

#ifdef MSG_NOSIGNAL
constexpr int kSendFlags = MSG_NOSIGNAL;
#else
constexpr int kSendFlags = 0;
#endif

void configure_socket_nosigpipe(const int fd) noexcept {
#ifdef SO_NOSIGPIPE
  int one = 1;
  (void)::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#else
  (void)fd;
#endif
}

void set_socket_timeout_ms(const int fd, const int optname, const std::int64_t timeout_ms) noexcept {
  const auto clamped_ms = std::max<std::int64_t>(1, timeout_ms);
  struct timeval tv{};
  tv.tv_sec = static_cast<decltype(tv.tv_sec)>(clamped_ms / 1000);
  tv.tv_usec = static_cast<decltype(tv.tv_usec)>((clamped_ms % 1000) * 1000);
  (void)::setsockopt(fd, SOL_SOCKET, optname, &tv, sizeof(tv));
}

std::uint16_t resolve_bound_port(const int server_fd, const std::uint16_t fallback_port) noexcept {
  sockaddr_storage addr{};
  socklen_t len = sizeof(addr);
  if (::getsockname(server_fd, reinterpret_cast<sockaddr*>(&addr), &len) < 0) {
    return fallback_port;
  }
  if (addr.ss_family == AF_INET) {
    return ntohs(reinterpret_cast<const sockaddr_in*>(&addr)->sin_port);
  }
  if (addr.ss_family == AF_INET6) {
    return ntohs(reinterpret_cast<const sockaddr_in6*>(&addr)->sin6_port);
  }
  return fallback_port;
}

bool send_all_bytes(const int client_fd, const char* data, const std::size_t length) noexcept {
  std::size_t written = 0;
  while (written < length) {
    errno = 0;
    const auto sent = ::send(client_fd, data + written, length - written, kSendFlags);
    if (sent <= 0) {
      if (sent < 0 && errno == EINTR) {
        continue;
      }
      return false;
    }
    written += static_cast<std::size_t>(sent);
  }
  return true;
}

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
  if (options_.keep_alive_timeout_secs == 0) {
    options_.keep_alive_timeout_secs = 15;
  }
  if (options_.max_keep_alive_requests == 0) {
    options_.max_keep_alive_requests = 1;
  }
}

void HttpServer::request_shutdown() {
  g_shutdown_requested.store(true, std::memory_order_release);
}

void HttpServer::reset_shutdown_for_testing() {
  g_shutdown_requested.store(false, std::memory_order_release);
}

void HttpServer::stop() const noexcept {
  stop_requested_.store(true, std::memory_order_release);
  const auto fd = listen_fd_.load(std::memory_order_acquire);
  if (fd >= 0) {
    (void)::shutdown(fd, SHUT_RDWR);
  }
}

std::uint16_t HttpServer::bound_port() const noexcept {
  return bound_port_.load(std::memory_order_acquire);
}

bool HttpServer::should_stop() const noexcept {
  return stop_requested_.load(std::memory_order_acquire) ||
         g_shutdown_requested.load(std::memory_order_acquire);
}

void HttpServer::serve_forever() const {
  stop_requested_.store(false, std::memory_order_release);

  // 优先尝试双栈套接字（AF_INET6 + IPV6_V6ONLY=0），不可用时平滑回退 IPv4
  const auto server_fd = ::socket(AF_INET6, SOCK_STREAM, 0);
  if (server_fd < 0) {
    serve_forever_ipv4();
    return;
  }

  int option = 1;
  (void)::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &option, sizeof(option));

  int v6only = 0;
  if (::setsockopt(server_fd, IPPROTO_IPV6, IPV6_V6ONLY, &v6only, sizeof(v6only)) < 0) {
    ::close(server_fd);
    serve_forever_ipv4();
    return;
  }

  sockaddr_in6 address{};
  address.sin6_family = AF_INET6;
  address.sin6_port = htons(bind_port_);
  address.sin6_addr = in6addr_any;
  if (bind_host_ != "0.0.0.0" && bind_host_ != "::") {
    if (::inet_pton(AF_INET6, bind_host_.c_str(), &address.sin6_addr) <= 0) {
      ::close(server_fd);
      serve_forever_ipv4();
      return;
    }
  }

  if (::bind(server_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
    ::close(server_fd);
    serve_forever_ipv4();
    return;
  }

  if (::listen(server_fd, SOMAXCONN) < 0) {
    ::close(server_fd);
    throw std::runtime_error("listen on socket");
  }

  serve_accept_loop(server_fd);
}

void HttpServer::serve_forever_ipv4() const {
  const auto server_fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (server_fd < 0) {
    throw std::runtime_error("create listen socket");
  }

  int option = 1;
  (void)::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &option, sizeof(option));

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

  serve_accept_loop(server_fd);
}

void HttpServer::serve_accept_loop(const int server_fd) const {
  listen_fd_.store(server_fd, std::memory_order_release);
  bound_port_.store(resolve_bound_port(server_fd, bind_port_), std::memory_order_release);

  std::deque<int> work_queue;
  std::mutex queue_mutex;
  std::condition_variable queue_cv;
  bool queue_stopping = false;
  std::atomic<bool> worker_stopping{false};

  std::vector<std::jthread> workers;
  workers.reserve(options_.worker_count);
  for (std::size_t index = 0; index < options_.worker_count; ++index) {
    workers.emplace_back([this, &work_queue, &queue_mutex, &queue_cv, &queue_stopping, &worker_stopping]() {
      while (true) {
        int client_fd = -1;
        {
          std::unique_lock lock(queue_mutex);
          // 同时等待任务入队或停机广播信号，杜绝 jthread 析构死锁
          queue_cv.wait(lock, [&work_queue, &queue_stopping]() {
            return queue_stopping || !work_queue.empty();
          });
          if (work_queue.empty()) {
            break;
          }
          client_fd = work_queue.front();
          work_queue.pop_front();
          if (options_.metrics != nullptr) {
            options_.metrics->set_queue_depth(work_queue.size());
          }
        }
        if (options_.metrics != nullptr) {
          options_.metrics->worker_started();
        }
        handle_client(client_fd, worker_stopping);
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

  // 注册进程级信号处理器以支持 SIGTERM / SIGINT 平滑退出
  struct sigaction sa{};
  sa.sa_handler = [](int) { g_shutdown_requested.store(true, std::memory_order_release); };
  sigemptyset(&sa.sa_mask);
  ::sigaction(SIGTERM, &sa, nullptr);
  ::sigaction(SIGINT, &sa, nullptr);

  while (!should_stop()) {
    struct pollfd pfd{};
    pfd.fd = server_fd;
    pfd.events = POLLIN;
    const auto poll_rc = ::poll(&pfd, 1, 100);
    if (poll_rc <= 0) {
      continue;
    }
    if ((pfd.revents & (POLLIN | POLLERR | POLLHUP)) == 0) {
      continue;
    }

    sockaddr_storage client_address{};
    socklen_t client_length = sizeof(client_address);
    const auto client_fd =
        ::accept(server_fd, reinterpret_cast<sockaddr*>(&client_address), &client_length);
    if (client_fd < 0) {
      if (should_stop()) {
        break;
      }
      continue;
    }
    configure_socket_nosigpipe(client_fd);
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
      if (!queue_stopping && work_queue.size() < options_.queue_capacity) {
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

  listen_fd_.store(-1, std::memory_order_release);
  ::close(server_fd);
  worker_stopping.store(true, std::memory_order_release);
  {
    std::lock_guard lock(queue_mutex);
    queue_stopping = true;
  }
  queue_cv.notify_all();
  std::cout << "[http] shutdown requested, draining connections..." << std::endl;
}

bool HttpServer::wait_for_idle_request(
    const int client_fd,
    std::string& prebuffer,
    const std::atomic<bool>& worker_stopping) const {
  if (!prebuffer.empty()) {
    return true;
  }
  if (worker_stopping.load(std::memory_order_acquire) || should_stop()) {
    return false;
  }

  // 在空闲复用阶段按 Keep-Alive 超时等待下一请求首包，客户端正常关闭或空闲超时静默回收
  const auto idle_timeout_ms =
      static_cast<std::int64_t>(options_.keep_alive_timeout_secs) * 1000;
  set_socket_timeout_ms(client_fd, SO_RCVTIMEO, idle_timeout_ms);

  char buffer[kBufferSize];
  while (true) {
    if (worker_stopping.load(std::memory_order_acquire) || should_stop()) {
      return false;
    }
    errno = 0;
    const auto received = ::recv(client_fd, buffer, sizeof(buffer), 0);
    if (received == 0) {
      return false;
    }
    if (received < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    prebuffer.append(buffer, static_cast<std::size_t>(received));
    return true;
  }
}

void HttpServer::handle_client(
    const int client_fd,
    const std::atomic<bool>& worker_stopping) const {
  const auto send_timeout_ms =
      static_cast<std::int64_t>(options_.request_timeout_secs) * 1000;
  set_socket_timeout_ms(client_fd, SO_SNDTIMEO, send_timeout_ms);

  std::string prebuffer;
  std::size_t requests_handled = 0;

  while (requests_handled < options_.max_keep_alive_requests) {
    if (requests_handled > 0 && !wait_for_idle_request(client_fd, prebuffer, worker_stopping)) {
      break;
    }

    try {
      const auto request = read_request(client_fd, prebuffer);
      requests_handled += 1;

      const auto conn_it = request.headers.find("connection");
      const auto conn_val = conn_it != request.headers.end() ? to_lower(conn_it->second) : std::string{};
      bool client_wants_keep_alive = true;
      if (conn_val.find("close") != std::string::npos) {
        client_wants_keep_alive = false;
      } else if (request.http_version == "HTTP/1.0") {
        client_wants_keep_alive = (conn_val.find("keep-alive") != std::string::npos);
      }

      const bool keep_alive =
          client_wants_keep_alive &&
          requests_handled < options_.max_keep_alive_requests &&
          !worker_stopping.load(std::memory_order_acquire) &&
          !should_stop();
      const std::size_t remaining_requests =
          keep_alive ? (options_.max_keep_alive_requests - requests_handled) : 0;

      const auto response = handler_(request);
      if (!write_response(client_fd, response, keep_alive, remaining_requests) || !keep_alive) {
        break;
      }
    } catch (const HttpReadError& error) {
      if (options_.metrics != nullptr) {
        options_.metrics->record_read_error(error.status_code);
      }
      (void)write_response(
          client_fd,
          error_response(error.status_code, error.code, error.message),
          /*keep_alive=*/false,
          0);
      break;
    } catch (const std::exception& error) {
      if (options_.metrics != nullptr) {
        options_.metrics->record_read_error(500);
      }
      std::cerr << "[http] handler error: " << error.what() << std::endl;
      const auto response = HttpResponse{
          .status_code = 500,
          .body = "{\"success\":false,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"internal server error\"}}",
      };
      (void)write_response(client_fd, response, /*keep_alive=*/false, 0);
      break;
    }
  }

  ::close(client_fd);
}

HttpRequest HttpServer::read_request(const int client_fd, std::string& prebuffer) const {
  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(options_.request_timeout_secs);

  // 每次读取均受整请求总截止时间约束，防止慢速分片连接耗尽工作线程
  const auto recv_chunk = [&](char* dst, const std::size_t cap, const char* timeout_msg, const char* eof_msg) -> std::size_t {
    while (true) {
      const auto remaining_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                    deadline - std::chrono::steady_clock::now())
                                    .count();
      if (remaining_ms <= 0) {
        throw HttpReadError(408, "REQUEST_TIMEOUT", timeout_msg);
      }
      set_socket_timeout_ms(client_fd, SO_RCVTIMEO, remaining_ms);
      errno = 0;
      const auto received = ::recv(client_fd, dst, cap, 0);
      if (received > 0) {
        return static_cast<std::size_t>(received);
      }
      if (received < 0 && errno == EINTR) {
        continue;
      }
      if (received < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
        throw HttpReadError(408, "REQUEST_TIMEOUT", timeout_msg);
      }
      throw HttpReadError(400, "INVALID_REQUEST", eof_msg);
    }
  };

  std::string raw_request = std::move(prebuffer);
  prebuffer.clear();

  char buffer[kBufferSize];
  const std::size_t max_header_and_body = options_.max_body_bytes + 64 * 1024;
  while (raw_request.find("\r\n\r\n") == std::string::npos) {
    const auto received = recv_chunk(
        buffer,
        sizeof(buffer),
        "request timed out while reading headers",
        "failed to read request headers");
    raw_request.append(buffer, received);
    if (raw_request.size() > max_header_and_body) {
      throw HttpReadError(413, "REQUEST_TOO_LARGE", "request exceeds maximum size");
    }
  }

  const auto header_end = raw_request.find("\r\n\r\n");
  const auto headers_block = raw_request.substr(0, header_end);
  auto stream_remainder = raw_request.substr(header_end + 4);

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
  if (request.method.empty() || request.path.empty()) {
    throw HttpReadError(400, "INVALID_REQUEST", "malformed request line");
  }
  if (!version.empty()) {
    request.http_version = version;
  }

  std::string header_line;
  std::size_t content_length = 0;
  bool has_content_length = false;
  bool is_chunked = false;
  bool expect_continue = false;

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
      has_content_length = true;
      try {
        content_length = static_cast<std::size_t>(std::stoull(value));
      } catch (const std::exception&) {
        throw HttpReadError(400, "INVALID_REQUEST", "invalid content-length");
      }
      if (content_length > options_.max_body_bytes) {
        throw HttpReadError(413, "REQUEST_TOO_LARGE", "content-length exceeds maximum");
      }
    } else if (key == "transfer-encoding") {
      if (to_lower(value).find("chunked") != std::string::npos) {
        is_chunked = true;
      }
    } else if (key == "expect") {
      if (to_lower(value) == "100-continue") {
        expect_continue = true;
      }
    }
  }

  // 同时携带 Transfer-Encoding 与 Content-Length 违反 RFC 9112 防请求走私约束，直接拒绝
  if (is_chunked && has_content_length) {
    throw HttpReadError(400, "INVALID_REQUEST", "conflicting transfer-encoding and content-length");
  }

  if (expect_continue) {
    static constexpr char kContinueResponse[] = "HTTP/1.1 100 Continue\r\n\r\n";
    if (!send_all_bytes(client_fd, kContinueResponse, sizeof(kContinueResponse) - 1)) {
      throw HttpReadError(400, "INVALID_REQUEST", "failed to send 100-continue");
    }
  }

  if (is_chunked) {
    std::string decoded_body;
    std::size_t cursor = 0;
    while (true) {
      while (stream_remainder.find("\r\n", cursor) == std::string::npos) {
        const auto received = recv_chunk(
            buffer,
            sizeof(buffer),
            "request timed out while reading chunk header",
            "failed to read chunk header");
        stream_remainder.append(buffer, received);
      }
      const auto line_end = stream_remainder.find("\r\n", cursor);
      auto size_token = stream_remainder.substr(cursor, line_end - cursor);
      if (const auto ext_pos = size_token.find(';'); ext_pos != std::string::npos) {
        size_token = size_token.substr(0, ext_pos);
      }
      size_token = trim(size_token);
      std::size_t chunk_size = 0;
      try {
        chunk_size = static_cast<std::size_t>(std::stoull(size_token, nullptr, 16));
      } catch (const std::exception&) {
        throw HttpReadError(400, "INVALID_REQUEST", "invalid chunk size");
      }
      cursor = line_end + 2;

      if (decoded_body.size() + chunk_size > options_.max_body_bytes) {
        throw HttpReadError(413, "REQUEST_TOO_LARGE", "chunked body exceeds maximum");
      }

      while (stream_remainder.size() - cursor < chunk_size + 2) {
        const auto received = recv_chunk(
            buffer,
            sizeof(buffer),
            "request timed out while reading chunk body",
            "failed to read chunk body");
        stream_remainder.append(buffer, received);
      }

      if (stream_remainder.compare(cursor + chunk_size, 2, "\r\n") != 0) {
        throw HttpReadError(400, "INVALID_REQUEST", "malformed chunk delimiter");
      }

      if (chunk_size == 0) {
        cursor += 2;
        break;
      }
      decoded_body.append(stream_remainder, cursor, chunk_size);
      cursor += chunk_size + 2;
    }
    request.body = std::move(decoded_body);
    if (cursor < stream_remainder.size()) {
      prebuffer = stream_remainder.substr(cursor);
    }
  } else {
    while (stream_remainder.size() < content_length) {
      const auto received = recv_chunk(
          buffer,
          sizeof(buffer),
          "request timed out while reading body",
          "failed to read request body");
      stream_remainder.append(buffer, received);
    }
    request.body = stream_remainder.substr(0, content_length);
    // 将同一连接上流水线预读的下一请求字节保留至连接缓冲区
    if (stream_remainder.size() > content_length) {
      prebuffer = stream_remainder.substr(content_length);
    }
  }

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
  const auto send_timeout_ms =
      static_cast<std::int64_t>(options_.request_timeout_secs) * 1000;
  set_socket_timeout_ms(client_fd, SO_SNDTIMEO, send_timeout_ms);
  (void)write_response(
      client_fd,
      error_response(503, "SERVER_OVERLOADED", "server is overloaded"),
      /*keep_alive=*/false,
      0);
  ::close(client_fd);
}

bool HttpServer::write_response(
    const int client_fd,
    const HttpResponse& response,
    const bool keep_alive,
    const std::size_t remaining_requests) const {
  std::ostringstream stream;
  stream << "HTTP/1.1 " << response.status_code << ' ' << reason_phrase(response.status_code) << "\r\n";
  stream << "Content-Type: " << response.content_type << "\r\n";
  stream << "Content-Length: " << response.body.size() << "\r\n";
  if (keep_alive) {
    stream << "Connection: keep-alive\r\n";
    stream << "Keep-Alive: timeout=" << options_.keep_alive_timeout_secs
           << ", max=" << remaining_requests << "\r\n\r\n";
  } else {
    stream << "Connection: close\r\n\r\n";
  }
  stream << response.body;
  const auto wire = stream.str();
  return send_all_bytes(client_fd, wire.data(), wire.size());
}

std::string HttpServer::reason_phrase(const int status_code) {
  switch (status_code) {
    case 200:
      return "OK";
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
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
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

}  // namespace telegram::graph::http
