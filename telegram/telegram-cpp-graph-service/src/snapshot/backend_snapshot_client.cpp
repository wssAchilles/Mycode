#include "snapshot/backend_snapshot_client.h"

#include <memory>
#include <sstream>
#include <stdexcept>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

namespace telegram::graph::snapshot {
namespace {

std::size_t append_body(void* contents, const std::size_t size, const std::size_t nmemb, void* userp) {
  const auto total_size = size * nmemb;
  auto* body = static_cast<std::string*>(userp);
  body->append(static_cast<char*>(contents), total_size);
  return total_size;
}

struct CurlEasyDeleter {
  void operator()(CURL* handle) const noexcept {
    if (handle != nullptr) {
      curl_easy_cleanup(handle);
    }
  }
};

class CurlHeaderList {
 public:
  CurlHeaderList() = default;
  ~CurlHeaderList() { curl_slist_free_all(headers_); }

  CurlHeaderList(const CurlHeaderList&) = delete;
  CurlHeaderList& operator=(const CurlHeaderList&) = delete;

  void append(const char* header) {
    auto* appended = curl_slist_append(headers_, header);
    if (appended == nullptr) {
      throw std::runtime_error("append curl backend generation header");
    }
    headers_ = appended;
  }

  [[nodiscard]] curl_slist* get() const noexcept { return headers_; }

 private:
  curl_slist* headers_{nullptr};
};

nlohmann::json post_generation_json(
    const std::string& url,
    const nlohmann::json& body,
    const std::string& internal_token,
    const std::uint64_t timeout_ms) {
  const auto payload = body.dump();
  std::unique_ptr<CURL, CurlEasyDeleter> handle(curl_easy_init());
  if (!handle) {
    throw std::runtime_error("init curl backend generation client");
  }

  std::string response_body;
  CurlHeaderList headers;
  headers.append("Content-Type: application/json");
  if (!internal_token.empty()) {
    const auto auth_header = std::string("x-graph-kernel-internal-token: ") + internal_token;
    headers.append(auth_header.c_str());
  }

  curl_easy_setopt(handle.get(), CURLOPT_URL, url.c_str());
  curl_easy_setopt(handle.get(), CURLOPT_HTTPHEADER, headers.get());
  curl_easy_setopt(handle.get(), CURLOPT_POST, 1L);
  curl_easy_setopt(handle.get(), CURLOPT_POSTFIELDS, payload.c_str());
  curl_easy_setopt(handle.get(), CURLOPT_POSTFIELDSIZE, payload.size());
  curl_easy_setopt(handle.get(), CURLOPT_TIMEOUT_MS, timeout_ms);
  curl_easy_setopt(handle.get(), CURLOPT_WRITEFUNCTION, append_body);
  curl_easy_setopt(handle.get(), CURLOPT_WRITEDATA, &response_body);
  curl_easy_setopt(handle.get(), CURLOPT_NOSIGNAL, 1L);

  const auto result = curl_easy_perform(handle.get());
  long status_code = 0;
  curl_easy_getinfo(handle.get(), CURLINFO_RESPONSE_CODE, &status_code);

  if (result != CURLE_OK) {
    throw std::runtime_error(
        std::string("backend generation request failed: ") + curl_easy_strerror(result));
  }
  if (status_code < 200 || status_code >= 300) {
    std::ostringstream stream;
    stream << "backend generation request returned status=" << status_code
           << " body=" << response_body;
    throw std::runtime_error(stream.str());
  }
  return nlohmann::json::parse(response_body);
}

}  // namespace

BackendSnapshotClient::BackendSnapshotClient(
    std::string base_url,
    std::string internal_token,
    const std::uint64_t timeout_ms)
    : base_url_(std::move(base_url)),
      internal_token_(std::move(internal_token)),
      timeout_ms_(timeout_ms) {
}

contracts::SnapshotPagePayload BackendSnapshotClient::fetch_page(
    const std::size_t offset,
    const std::size_t limit,
    const double min_edge_score) const {
  return fetch_page_with_cursor(offset, limit, min_edge_score, "", std::nullopt);
}

contracts::SnapshotPagePayload BackendSnapshotClient::fetch_page_with_cursor(
    const std::size_t offset,
    const std::size_t limit,
    const double min_edge_score,
    const std::string& snapshot_version,
    const std::optional<contracts::SnapshotCursor>& cursor) const {
  CURL* handle = curl_easy_init();
  if (handle == nullptr) {
    throw std::runtime_error("init curl backend snapshot client");
  }

  std::string response_body;
  auto request_json = nlohmann::json{
      {"offset", offset},
      {"limit", limit},
      {"minScore", min_edge_score},
  };
  if (!snapshot_version.empty()) {
    request_json["snapshotVersion"] = snapshot_version;
  }
  if (cursor.has_value()) {
    request_json["afterSourceUserId"] = cursor->after_source_user_id;
    request_json["afterTargetUserId"] = cursor->after_target_user_id;
    request_json["afterId"] = cursor->after_id;
  }
  const auto payload = request_json.dump();

  struct curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, "Content-Type: application/json");
  if (!internal_token_.empty()) {
    const auto auth_header = std::string("x-graph-kernel-internal-token: ") + internal_token_;
    headers = curl_slist_append(headers, auth_header.c_str());
  }

  curl_easy_setopt(handle, CURLOPT_URL, base_url_.c_str());
  curl_easy_setopt(handle, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(handle, CURLOPT_POST, 1L);
  curl_easy_setopt(handle, CURLOPT_POSTFIELDS, payload.c_str());
  curl_easy_setopt(handle, CURLOPT_POSTFIELDSIZE, payload.size());
  curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, timeout_ms_);
  curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, append_body);
  curl_easy_setopt(handle, CURLOPT_WRITEDATA, &response_body);
  curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1L);

  const auto result = curl_easy_perform(handle);
  long status_code = 0;
  curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status_code);
  curl_slist_free_all(headers);
  curl_easy_cleanup(handle);

  if (result != CURLE_OK) {
    throw std::runtime_error(std::string("backend snapshot request failed: ") + curl_easy_strerror(result));
  }
  if (status_code == 409) {
    throw SnapshotVersionConflictError("backend snapshot version changed during pagination");
  }
  if (status_code < 200 || status_code >= 300) {
    std::ostringstream stream;
    stream << "backend snapshot request returned status=" << status_code << " body=" << response_body;
    throw std::runtime_error(stream.str());
  }

  const auto envelope = nlohmann::json::parse(response_body);
  if (!envelope.value("success", false)) {
    throw std::runtime_error("backend snapshot response marked unsuccessful");
  }

  const auto data = envelope.at("data");
  contracts::SnapshotPagePayload page{
      .edges = {},
      .offset = data.value("offset", offset),
      .limit = data.value("limit", limit),
      .next_offset = std::nullopt,
      .next_cursor = std::nullopt,
      .done = data.value("done", true),
      .snapshot_version = data.value("snapshotVersion", std::string{}),
  };

  if (data.contains("nextOffset") && !data.at("nextOffset").is_null()) {
    page.next_offset = data.at("nextOffset").get<std::size_t>();
  }
  if (data.contains("nextCursor") && data.at("nextCursor").is_object()) {
    const auto& cur = data.at("nextCursor");
    const auto after_source = cur.value("afterSourceUserId", std::string{});
    const auto after_target = cur.value("afterTargetUserId", std::string{});
    const auto after_id = cur.value("afterId", std::string{});
    if (!after_source.empty() && !after_target.empty() && !after_id.empty()) {
      page.next_cursor = contracts::SnapshotCursor{
          .after_source_user_id = after_source,
          .after_target_user_id = after_target,
          .after_id = after_id,
      };
    }
  }

  for (const auto& edge_json : data.at("edges")) {
    page.edges.push_back(edge_json.get<contracts::SnapshotEdgeRecord>());
  }

  return page;
}

BackendGenerationClient::BackendGenerationClient(
    std::string base_url,
    std::string internal_token,
    const std::uint64_t timeout_ms)
    : BackendGenerationClient(
          std::move(base_url),
          std::move(internal_token),
          timeout_ms,
          post_generation_json) {}

BackendGenerationClient::BackendGenerationClient(
    std::string base_url,
    std::string internal_token,
    const std::uint64_t timeout_ms,
    Transport transport)
    : base_url_(std::move(base_url)),
      internal_token_(std::move(internal_token)),
      timeout_ms_(timeout_ms),
      transport_(std::move(transport)) {
  if (!transport_) {
    throw std::invalid_argument("backend generation transport must not be empty");
  }
}

generation::Page BackendGenerationClient::fetch_page(
    const generation::PageRequest& request) const {
  return generation::parse_page_envelope(transport_(
      base_url_ + "/generation/page",
      generation::serialize_page_request(request),
      internal_token_,
      timeout_ms_));
}

void BackendGenerationClient::release(
    const std::string& generation_id,
    const std::string& lease_id) const {
  const auto envelope = transport_(
      base_url_ + "/generation/release",
      generation::serialize_release_request(generation_id, lease_id),
      internal_token_,
      timeout_ms_);
  generation::validate_release_envelope(envelope, generation_id, lease_id);
}

}  // namespace telegram::graph::snapshot
