#pragma once

#include <cstddef>
#include <stdexcept>
#include <string>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace telegram::graph::http {

class RequestValidationError : public std::runtime_error {
 public:
  explicit RequestValidationError(std::string message);
};

std::string read_required_string(const nlohmann::json& body, const char* key);
std::unordered_set<std::string> read_optional_string_set(const nlohmann::json& body, const char* key);
std::size_t read_optional_size(
    const nlohmann::json& body,
    const char* key,
    std::size_t default_value,
    std::size_t max_value);
bool read_optional_bool(const nlohmann::json& body, const char* key, bool default_value);

}  // namespace telegram::graph::http
