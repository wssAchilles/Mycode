#include "http/http_server.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <cctype>
#include <sstream>
#include <stdexcept>
#include <thread>

namespace telegram::graph::http {
namespace {

constexpr std::size_t kBufferSize = 8192;

}  // namespace

HttpServer::HttpServer(std::string bind_host, const std::uint16_t bind_port, Handler handler)
    : bind_host_(std::move(bind_host)), bind_port_(bind_port), handler_(std::move(handler)) {}

void HttpServer::serve_forever() const {
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

  while (true) {
    sockaddr_in client_address{};
    socklen_t client_length = sizeof(client_address);
    const auto client_fd =
        ::accept(server_fd, reinterpret_cast<sockaddr*>(&client_address), &client_length);
    if (client_fd < 0) {
      continue;
    }

    std::thread([this, client_fd]() {
      handle_client(client_fd);
    }).detach();
  }
}

void HttpServer::handle_client(const int client_fd) const {
  try {
    const auto request = read_request(client_fd);
    const auto response = handler_(request);
    write_response(client_fd, response);
  } catch (const std::exception& error) {
    const auto response = HttpResponse{
        .status_code = 500,
        .body = std::string("{\"success\":false,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"") +
            error.what() + "\"}}",
    };
    write_response(client_fd, response);
  }
  ::close(client_fd);
}

HttpRequest HttpServer::read_request(const int client_fd) const {
  std::string raw_request;
  char buffer[kBufferSize];
  while (raw_request.find("\r\n\r\n") == std::string::npos) {
    const auto received = ::recv(client_fd, buffer, sizeof(buffer), 0);
    if (received <= 0) {
      throw std::runtime_error("read request headers");
    }
    raw_request.append(buffer, received);
    if (raw_request.size() > 1024 * 1024) {
      throw std::runtime_error("request too large");
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
      content_length = static_cast<std::size_t>(std::stoull(value));
    }
  }

  while (body.size() < content_length) {
    const auto received = ::recv(client_fd, buffer, sizeof(buffer), 0);
    if (received <= 0) {
      throw std::runtime_error("read request body");
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

void HttpServer::write_response(const int client_fd, const HttpResponse& response) const {
  std::ostringstream stream;
  stream << "HTTP/1.1 " << response.status_code << ' ' << reason_phrase(response.status_code) << "\r\n";
  stream << "Content-Type: " << response.content_type << "\r\n";
  stream << "Content-Length: " << response.body.size() << "\r\n";
  stream << "Connection: close\r\n\r\n";
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
