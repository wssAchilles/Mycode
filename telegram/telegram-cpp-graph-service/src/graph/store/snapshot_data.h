#pragma once

#include <cstddef>
#include <string>
#include <unordered_map>
#include <vector>

#include "graph/domain/weighted_neighbor.h"
#include "graph/snapshot/metadata.h"
#include "graph/snapshot/string_interner.h"

namespace telegram::graph::core::store {

struct SnapshotData {
  using WeightedNeighbor = domain::WeightedNeighbor;

  struct DenseNeighborRef {
    snapshot::StringInterner::Id target_id;
    const WeightedNeighbor* neighbor;
  };

  std::unordered_map<std::string, std::vector<WeightedNeighbor>> adjacency;
  std::unordered_map<std::string, std::vector<const WeightedNeighbor*>> neighbors_by_user_id;
  std::vector<std::size_t> dense_source_offsets;
  std::vector<DenseNeighborRef> dense_neighbors;
  std::vector<std::size_t> dense_ranked_source_offsets;
  std::vector<DenseNeighborRef> dense_ranked_neighbors;
  snapshot::StringInterner user_ids;
  snapshot::StringInterner edge_kind_ids;
  SnapshotMetadata metadata;
};

}  // namespace telegram::graph::core::store
