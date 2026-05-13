#pragma once

#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace telegram::graph::core::snapshot {

class StringInterner {
 public:
  using Id = std::uint32_t;

  void reserve(const std::size_t expected_values) {
    ids_.reserve(expected_values);
    values_.reserve(expected_values);
  }

  Id intern(const std::string& value) {
    const auto found = ids_.find(value);
    if (found != ids_.end()) {
      return found->second;
    }
    const auto next_id = static_cast<Id>(values_.size());
    values_.push_back(value);
    ids_.emplace(values_.back(), next_id);
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
    total += ids_.size() * (sizeof(std::string) + sizeof(Id));
    for (const auto& [key, id] : ids_) {
      (void)id;
      total += key.capacity();
    }
    return total;
  }

 private:
  std::unordered_map<std::string, Id> ids_;
  std::vector<std::string> values_;
};

}  // namespace telegram::graph::core::snapshot
