#pragma once

#include <cstddef>
#include <optional>
#include <string>

#include "contracts/types.h"

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

}  // namespace telegram::graph::snapshot
