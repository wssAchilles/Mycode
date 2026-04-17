#include "snapshot/backend_snapshot_client.h"

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

}  // namespace

BackendSnapshotClient::BackendSnapshotClient(
    std::string base_url,
    std::string internal_token,
    const std::uint64_t timeout_ms)
    : base_url_(std::move(base_url)),
      internal_token_(std::move(internal_token)),
      timeout_ms_(timeout_ms) {
  curl_global_init(CURL_GLOBAL_DEFAULT);
}

BackendSnapshotClient::~BackendSnapshotClient() {
  curl_global_cleanup();
}

contracts::SnapshotPagePayload BackendSnapshotClient::fetch_page(
    const std::size_t offset,
    const std::size_t limit,
    const double min_edge_score) const {
  CURL* handle = curl_easy_init();
  if (handle == nullptr) {
    throw std::runtime_error("init curl backend snapshot client");
  }

  std::string response_body;
  const auto payload = nlohmann::json{
      {"offset", offset},
      {"limit", limit},
      {"minScore", min_edge_score},
  }
                           .dump();

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

  const auto result = curl_easy_perform(handle);
  long status_code = 0;
  curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &status_code);
  curl_slist_free_all(headers);
  curl_easy_cleanup(handle);

  if (result != CURLE_OK) {
    throw std::runtime_error(std::string("backend snapshot request failed: ") + curl_easy_strerror(result));
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
      .done = data.value("done", true),
  };

  if (data.contains("nextOffset") && !data.at("nextOffset").is_null()) {
    page.next_offset = data.at("nextOffset").get<std::size_t>();
  }

  for (const auto& edge_json : data.at("edges")) {
    page.edges.push_back(edge_json.get<contracts::SnapshotEdgeRecord>());
  }

  return page;
}

}  // namespace telegram::graph::snapshot
