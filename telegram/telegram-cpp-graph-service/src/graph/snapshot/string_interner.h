#pragma once

#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace telegram::graph::core::snapshot {

class StringInterner {
 public:
  using Id = std::uint32_t;

  void reserve(const std::size_t expected_values) {
    // Pre-allocate vector to guarantee pointer stability for string_views
    values_.reserve(expected_values);
    ids_.reserve(expected_values);
  }

  Id intern(const std::string& value) {
    const auto found = ids_.find(value);
    if (found != ids_.end()) {
      return found->second;
    }
    const auto next_id = static_cast<Id>(values_.size());
    values_.push_back(value);
    // Use string_view pointing to the stable vector element
    ids_.emplace(std::string_view(values_.back()), next_id);
    return next_id;
  }

  std::optional<Id> find(const std::string& value) const {
    const auto found = ids_.find(value);
    if (found == ids_.end()) {
      return std::nullopt;
    }
    return found->second;
  }

  const std::string& value(const Id id) const {
    if (id >= values_.size()) {
      throw std::out_of_range("string interner id out of range");
    }
    return values_[id];
  }

  std::size_t size() const noexcept {
    return values_.size();
  }

  std::size_t memory_estimate_bytes() const {
    std::size_t total = sizeof(StringInterner);
    total += values_.capacity() * sizeof(std::string);
    for (const auto& value : values_) {
      total += value.capacity();
    }
    // ids_ now stores string_view (no duplicate allocation)
    total += ids_.size() * (sizeof(std::string_view) + sizeof(Id));
    return total;
  }

 private:
  // string_view keys point into values_ vector (pointer-stable since we only append)
  std::unordered_map<std::string_view, Id> ids_;
  std::vector<std::string> values_;
};

}  // namespace telegram::graph::core::snapshot
