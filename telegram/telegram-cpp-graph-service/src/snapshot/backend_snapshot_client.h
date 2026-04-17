#pragma once

#include <cstddef>
#include <optional>
#include <string>

#include "contracts/types.h"

namespace telegram::graph::snapshot {

class BackendSnapshotClient {
 public:
  BackendSnapshotClient(std::string base_url, std::string internal_token, std::uint64_t timeout_ms);
  ~BackendSnapshotClient();

  contracts::SnapshotPagePayload fetch_page(
      std::size_t offset,
      std::size_t limit,
      double min_edge_score) const;

 private:
  std::string base_url_;
  std::string internal_token_;
  std::uint64_t timeout_ms_;
};

}  // namespace telegram::graph::snapshot
