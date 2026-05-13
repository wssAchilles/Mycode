#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace telegram::graph::core::snapshot {

inline std::size_t string_capacity_bytes(const std::string& value) {
  return value.capacity();
}

template <typename T>
std::size_t vector_storage_bytes(const std::vector<T>& values) {
  return values.capacity() * sizeof(T);
}

template <typename StringValues>
std::size_t string_vector_storage_bytes(const StringValues& values) {
  std::size_t total = values.capacity() * sizeof(std::string);
  for (const auto& value : values) {
    total += string_capacity_bytes(value);
  }
  return total;
}

}  // namespace telegram::graph::core::snapshot
