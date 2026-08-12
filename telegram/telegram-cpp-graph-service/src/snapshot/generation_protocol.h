#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "contracts/types.h"

namespace telegram::graph::snapshot::generation {

struct Cursor {
  std::string generation_id;
  std::string after_source_user_id;
  std::string after_target_user_id;
  std::string after_edge_id;

  bool operator==(const Cursor&) const = default;
};

struct Manifest {
  std::string generation_id;
  std::string content_version;
  std::string status;
  std::size_t edge_count;
  std::string canonical_sha256;
  std::int64_t created_at_ms;
  std::optional<std::string> diagnostic;

  bool operator==(const Manifest&) const = default;
};

struct Edge {
  std::string edge_id;
  contracts::SnapshotEdgeRecord record;
};

struct PageRequest {
  std::size_t limit;
  std::optional<std::string> lease_id;
  std::optional<Cursor> cursor;
};

struct Page {
  std::string generation_id;
  std::string lease_id;
  std::int64_t expires_at_ms;
  Manifest manifest;
  std::vector<Edge> edges;
  std::optional<Cursor> next_cursor;
  bool done;
};

class PageSource {
 public:
  virtual ~PageSource() = default;

  virtual Page fetch_page(const PageRequest& request) const = 0;
  virtual void release(
      const std::string& generation_id,
      const std::string& lease_id) const = 0;
};

class CanonicalEdgeHasher {
 public:
  CanonicalEdgeHasher();
  ~CanonicalEdgeHasher();

  CanonicalEdgeHasher(const CanonicalEdgeHasher&) = delete;
  CanonicalEdgeHasher& operator=(const CanonicalEdgeHasher&) = delete;

  void update(const Edge& edge);
  std::string finish();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

nlohmann::json serialize_page_request(const PageRequest& request);
nlohmann::json serialize_release_request(
    const std::string& generation_id,
    const std::string& lease_id);
Page parse_page_envelope(const nlohmann::json& envelope);
void validate_release_envelope(
    const nlohmann::json& envelope,
    const std::string& expected_generation_id,
    const std::string& expected_lease_id);

}  // namespace telegram::graph::snapshot::generation
