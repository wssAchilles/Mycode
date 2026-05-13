#include "http/routes/request_validation.h"

#include <limits>
#include <utility>

namespace telegram::graph::http {

RequestValidationError::RequestValidationError(std::string message)
    : std::runtime_error(std::move(message)) {}

std::string read_required_string(const nlohmann::json& body, const char* key) {
  if (!body.contains(key) || !body.at(key).is_string()) {
    throw RequestValidationError(std::string("missing or invalid string field: ") + key);
  }
  const auto value = body.at(key).get<std::string>();
  if (value.empty()) {
    throw RequestValidationError(std::string("empty string field: ") + key);
  }
  return value;
}

std::unordered_set<std::string> read_optional_string_set(const nlohmann::json& body, const char* key) {
  std::unordered_set<std::string> values;
  if (!body.contains(key) || body.at(key).is_null()) {
    return values;
  }
  if (!body.at(key).is_array()) {
    throw RequestValidationError(std::string("field must be a string array: ") + key);
  }

  for (const auto& value : body.at(key)) {
    if (!value.is_string()) {
      throw RequestValidationError(std::string("field must contain only strings: ") + key);
    }
    const auto parsed = value.get<std::string>();
    if (!parsed.empty()) {
      values.insert(parsed);
    }
  }
  return values;
}

std::size_t read_optional_size(
    const nlohmann::json& body,
    const char* key,
    const std::size_t default_value,
    const std::size_t max_value) {
  if (!body.contains(key) || body.at(key).is_null()) {
    return default_value;
  }
  const auto& value_json = body.at(key);
  if (!value_json.is_number_integer() && !value_json.is_number_unsigned()) {
    throw RequestValidationError(std::string("field must be an integer: ") + key);
  }
  std::size_t parsed = 0;
  if (value_json.is_number_unsigned()) {
    const auto value = value_json.get<unsigned long long>();
    if (value > std::numeric_limits<std::size_t>::max()) {
      throw RequestValidationError(std::string("field is out of range: ") + key);
    }
    parsed = static_cast<std::size_t>(value);
  } else {
    const auto value = value_json.get<long long>();
    if (value < 0 || static_cast<unsigned long long>(value) > std::numeric_limits<std::size_t>::max()) {
      throw RequestValidationError(std::string("field is out of range: ") + key);
    }
    parsed = static_cast<std::size_t>(value);
  }
  if (parsed > max_value) {
    throw RequestValidationError(std::string("field exceeds configured maximum: ") + key);
  }
  return parsed;
}

bool read_optional_bool(const nlohmann::json& body, const char* key, const bool default_value) {
  if (!body.contains(key) || body.at(key).is_null()) {
    return default_value;
  }
  if (!body.at(key).is_boolean()) {
    throw RequestValidationError(std::string("field must be boolean: ") + key);
  }
  return body.at(key).get<bool>();
}

}  // namespace telegram::graph::http
