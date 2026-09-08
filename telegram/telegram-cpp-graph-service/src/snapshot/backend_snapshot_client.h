#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "contracts/types.h"
#include "snapshot/generation_protocol.h"

namespace telegram::graph::snapshot {

class SnapshotPageSource {
 public:
  virtual ~SnapshotPageSource() = default;

  virtual contracts::SnapshotPagePayload fetch_page(
      std::size_t offset,
      std::size_t limit,
      double min_edge_score) const = 0;
};

class BackendSnapshotClient final : public SnapshotPageSource {
 public:
  BackendSnapshotClient(std::string base_url, std::string internal_token, std::uint64_t timeout_ms);

  contracts::SnapshotPagePayload fetch_page(
      std::size_t offset,
      std::size_t limit,
      double min_edge_score) const override;

 private:
  std::string base_url_;
  std::string internal_token_;
  std::uint64_t timeout_ms_;
};

class BackendGenerationClient final : public generation::PageSource {
 public:
  using Transport = std::function<nlohmann::json(
      const std::string& url,
      const nlohmann::json& body,
      const std::string& internal_token,
      std::uint64_t timeout_ms)>;

  BackendGenerationClient(
      std::string base_url,
      std::string internal_token,
      std::uint64_t timeout_ms);
  BackendGenerationClient(
      std::string base_url,
      std::string internal_token,
      std::uint64_t timeout_ms,
      Transport transport);

  generation::Page fetch_page(const generation::PageRequest& request) const override;
  void release(
      const std::string& generation_id,
      const std::string& lease_id) const override;

 private:
  std::string base_url_;
  std::string internal_token_;
  std::uint64_t timeout_ms_;
  Transport transport_;
};

}  // namespace telegram::graph::snapshot
