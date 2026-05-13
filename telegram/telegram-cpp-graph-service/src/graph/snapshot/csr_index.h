#pragma once

#include <cstddef>
#include <iterator>
#include <span>
#include <vector>

namespace telegram::graph::core::snapshot {

template <typename GroupedNeighbors, typename Offsets, typename FlatNeighbors>
void flatten_csr_index(GroupedNeighbors& grouped_neighbors, Offsets& offsets, FlatNeighbors& flat_neighbors) {
  offsets.resize(grouped_neighbors.size() + 1);
  std::size_t dense_offset = 0;
  for (std::size_t source_id = 0; source_id < grouped_neighbors.size(); ++source_id) {
    offsets[source_id] = dense_offset;
    dense_offset += grouped_neighbors[source_id].size();
  }
  offsets[grouped_neighbors.size()] = dense_offset;

  flat_neighbors.clear();
  flat_neighbors.reserve(dense_offset);
  for (auto& neighbors : grouped_neighbors) {
    flat_neighbors.insert(
        flat_neighbors.end(),
        std::make_move_iterator(neighbors.begin()),
        std::make_move_iterator(neighbors.end()));
  }
}

template <typename Ref>
std::span<const Ref> read_csr_span(
    const std::vector<std::size_t>& offsets,
    const std::vector<Ref>& flat_neighbors,
    const std::size_t source_id) {
  if (source_id + 1 >= offsets.size()) {
    return {};
  }
  const auto start = offsets[source_id];
  const auto end = offsets[source_id + 1];
  if (start >= end || end > flat_neighbors.size()) {
    return {};
  }
  return std::span<const Ref>(flat_neighbors.data() + start, end - start);
}

template <typename Ref>
std::size_t csr_memory_estimate_bytes(
    const std::vector<std::size_t>& offsets,
    const std::vector<Ref>& flat_neighbors) {
  return offsets.capacity() * sizeof(std::size_t) + flat_neighbors.capacity() * sizeof(Ref);
}

}  // namespace telegram::graph::core::snapshot
