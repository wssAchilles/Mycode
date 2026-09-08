#include "snapshot/generation_protocol.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string_view>

#include <openssl/evp.h>

namespace telegram::graph::snapshot::generation {
namespace {

constexpr std::uint64_t kMaxJsonSafeInteger = 9'007'199'254'740'991ULL;
constexpr std::size_t kMaxPageLimit = 5'000;
constexpr std::string_view kGenerationPrefix = "graph_generation_v2:";

using SignalCounts = contracts::EdgeSignalCounts;

struct CountField {
  std::string_view name;
  double SignalCounts::* value;
};

constexpr std::array<CountField, 16> kCountFields{{
    {"followCount", &SignalCounts::follow_count},
    {"likeCount", &SignalCounts::like_count},
    {"replyCount", &SignalCounts::reply_count},
    {"retweetCount", &SignalCounts::retweet_count},
    {"quoteCount", &SignalCounts::quote_count},
    {"mentionCount", &SignalCounts::mention_count},
    {"profileViewCount", &SignalCounts::profile_view_count},
    {"tweetClickCount", &SignalCounts::tweet_click_count},
    {"dwellTimeMs", &SignalCounts::dwell_time_ms},
    {"addressBookCount", &SignalCounts::address_book_count},
    {"directMessageCount", &SignalCounts::direct_message_count},
    {"coEngagementCount", &SignalCounts::co_engagement_count},
    {"contentAffinityCount", &SignalCounts::content_affinity_count},
    {"muteCount", &SignalCounts::mute_count},
    {"blockCount", &SignalCounts::block_count},
    {"reportCount", &SignalCounts::report_count},
}};

[[noreturn]] void invalid(const std::string& message) {
  throw std::invalid_argument("generation protocol: " + message);
}

std::string ecmascript_number(const double value) {
  if (!std::isfinite(value)) {
    invalid("canonical number must be finite");
  }
  if (value == 0.0) {
    return "0";
  }

  std::array<char, 64> buffer{};
  const auto [end, error] = std::to_chars(
      buffer.data(),
      buffer.data() + buffer.size(),
      value,
      std::chars_format::general);
  if (error != std::errc{}) {
    invalid("canonical number conversion failed");
  }

  std::string raw(buffer.data(), end);
  std::string sign;
  if (raw.front() == '-') {
    sign = "-";
    raw.erase(raw.begin());
  }

  std::string digits;
  int decimal_position = 0;
  const auto exponent_at = raw.find_first_of("eE");
  if (exponent_at != std::string::npos) {
    const auto mantissa = raw.substr(0, exponent_at);
    const auto decimal_at = mantissa.find('.');
    digits = mantissa;
    if (decimal_at != std::string::npos) {
      digits.erase(decimal_at, 1);
    }
    int exponent = 0;
    auto exponent_text = std::string_view(raw).substr(exponent_at + 1);
    if (!exponent_text.empty() && exponent_text.front() == '+') {
      exponent_text.remove_prefix(1);
    }
    const auto [parsed_to, parse_error] = std::from_chars(
        exponent_text.data(),
        exponent_text.data() + exponent_text.size(),
        exponent);
    if (parse_error != std::errc{} || parsed_to != exponent_text.data() + exponent_text.size()) {
      invalid("canonical number exponent conversion failed");
    }
    decimal_position = exponent + 1;
  } else {
    const auto decimal_at = raw.find('.');
    if (decimal_at == std::string::npos) {
      digits = raw;
      decimal_position = static_cast<int>(digits.size());
    } else if (decimal_at > 0 && raw.front() != '0') {
      digits = raw;
      digits.erase(decimal_at, 1);
      decimal_position = static_cast<int>(decimal_at);
    } else {
      const auto fraction = std::string_view(raw).substr(decimal_at + 1);
      const auto first_nonzero = fraction.find_first_not_of('0');
      if (first_nonzero == std::string_view::npos) {
        return "0";
      }
      digits = fraction.substr(first_nonzero);
      decimal_position = -static_cast<int>(first_nonzero);
    }
  }

  while (digits.size() > 1 && digits.back() == '0') {
    digits.pop_back();
  }
  const auto digit_count = static_cast<int>(digits.size());
  std::string result = std::move(sign);
  if (digit_count <= decimal_position && decimal_position <= 21) {
    result += digits;
    result.append(static_cast<std::size_t>(decimal_position - digit_count), '0');
  } else if (0 < decimal_position && decimal_position <= 21) {
    result.append(digits, 0, static_cast<std::size_t>(decimal_position));
    result.push_back('.');
    result.append(digits, static_cast<std::size_t>(decimal_position), std::string::npos);
  } else if (-6 < decimal_position && decimal_position <= 0) {
    result += "0.";
    result.append(static_cast<std::size_t>(-decimal_position), '0');
    result += digits;
  } else {
    result.push_back(digits.front());
    if (digit_count > 1) {
      result.push_back('.');
      result.append(digits, 1, std::string::npos);
    }
    const auto exponent = decimal_position - 1;
    result.push_back('e');
    if (exponent >= 0) {
      result.push_back('+');
    }
    result += std::to_string(exponent);
  }
  return result;
}

void append_json_string(std::string& output, const std::string& value) {
  output += nlohmann::json(value).dump();
}

void append_signal_counts(std::string& output, const SignalCounts& counts) {
  output.push_back('{');
  for (std::size_t index = 0; index < kCountFields.size(); ++index) {
    if (index > 0) {
      output.push_back(',');
    }
    output.push_back('"');
    output += kCountFields[index].name;
    output += "\":";
    output += ecmascript_number(counts.*(kCountFields[index].value));
  }
  output.push_back('}');
}

void append_optional_epoch(
    std::string& output,
    const std::optional<std::int64_t>& value) {
  output += value.has_value() ? std::to_string(value.value()) : "null";
}

std::string serialize_canonical_edge(const Edge& edge) {
  std::string output;
  output.reserve(1024);
  output += "{\"sourceUserId\":";
  append_json_string(output, edge.record.source_user_id);
  output += ",\"targetUserId\":";
  append_json_string(output, edge.record.target_user_id);
  output += ",\"edgeId\":";
  append_json_string(output, edge.edge_id);
  output += ",\"decayedSum\":";
  output += ecmascript_number(edge.record.decayed_sum);
  output += ",\"interactionProbability\":";
  output += ecmascript_number(edge.record.interaction_probability);
  output += ",\"dailySignalCounts\":";
  append_signal_counts(output, edge.record.daily_signal_counts);
  output += ",\"rollupSignalCounts\":";
  append_signal_counts(output, edge.record.rollup_signal_counts);
  output += ",\"edgeKinds\":[";
  for (std::size_t index = 0; index < edge.record.edge_kinds.size(); ++index) {
    if (index > 0) {
      output.push_back(',');
    }
    append_json_string(output, edge.record.edge_kinds[index]);
  }
  output += "],\"lastInteractionAtMs\":";
  append_optional_epoch(output, edge.record.last_interaction_at_ms);
  output += ",\"updatedAtMs\":";
  append_optional_epoch(output, edge.record.updated_at_ms);
  output.push_back('}');
  return output;
}

struct EvpContextDeleter {
  void operator()(EVP_MD_CTX* context) const noexcept {
    EVP_MD_CTX_free(context);
  }
};

void require_exact_keys(
    const nlohmann::json& object,
    const std::initializer_list<std::string_view> allowed,
    const std::string_view field) {
  if (!object.is_object()) {
    invalid(std::string(field) + " must be an object");
  }
  for (auto it = object.begin(); it != object.end(); ++it) {
    if (std::find(allowed.begin(), allowed.end(), it.key()) == allowed.end()) {
      invalid(std::string(field) + " contains unexpected field " + it.key());
    }
  }
}

const nlohmann::json& required(const nlohmann::json& object, const char* key) {
  if (!object.contains(key)) {
    invalid(std::string("missing ") + key);
  }
  return object.at(key);
}

std::string require_non_blank_string(const nlohmann::json& value, const std::string_view field) {
  if (!value.is_string()) {
    invalid(std::string(field) + " must be a string");
  }
  auto result = value.get<std::string>();
  if (result.find_first_not_of(" \t\n\r\f\v") == std::string::npos) {
    invalid(std::string(field) + " must not be blank");
  }
  return result;
}

bool is_lower_hex(const std::string_view value) {
  return std::all_of(value.begin(), value.end(), [](const char character) {
    return (character >= '0' && character <= '9') ||
        (character >= 'a' && character <= 'f');
  });
}

void validate_generation_id(const std::string_view generation_id) {
  if (!generation_id.starts_with(kGenerationPrefix)) {
    invalid("generationId has invalid prefix");
  }
  const auto hash = generation_id.substr(kGenerationPrefix.size());
  if (hash.size() != 64 || !is_lower_hex(hash)) {
    invalid("generationId has invalid hash");
  }
}

std::uint64_t require_safe_integer(const nlohmann::json& value, const std::string_view field) {
  std::uint64_t result = 0;
  if (value.is_number_unsigned()) {
    result = value.get<std::uint64_t>();
  } else if (value.is_number_integer()) {
    const auto signed_value = value.get<std::int64_t>();
    if (signed_value < 0) {
      invalid(std::string(field) + " must be non-negative");
    }
    result = static_cast<std::uint64_t>(signed_value);
  } else {
    invalid(std::string(field) + " must be an integer");
  }
  if (result > kMaxJsonSafeInteger) {
    invalid(std::string(field) + " exceeds JSON safe integer range");
  }
  return result;
}

std::size_t require_safe_size(const nlohmann::json& value, const std::string_view field) {
  const auto result = require_safe_integer(value, field);
  if (result > std::numeric_limits<std::size_t>::max()) {
    invalid(std::string(field) + " exceeds size range");
  }
  return static_cast<std::size_t>(result);
}

double require_finite_number(const nlohmann::json& value, const std::string_view field) {
  if (!value.is_number()) {
    invalid(std::string(field) + " must be a number");
  }
  const auto result = value.get<double>();
  if (!std::isfinite(result)) {
    invalid(std::string(field) + " must be finite");
  }
  return result;
}

void validate_signal_counts(const nlohmann::json& value, const std::string_view field) {
  constexpr std::string_view keys[]{
      "followCount",
      "likeCount",
      "replyCount",
      "retweetCount",
      "quoteCount",
      "mentionCount",
      "profileViewCount",
      "tweetClickCount",
      "dwellTimeMs",
      "addressBookCount",
      "directMessageCount",
      "coEngagementCount",
      "contentAffinityCount",
      "muteCount",
      "blockCount",
      "reportCount",
  };
  require_exact_keys(
      value,
      {
          "followCount",
          "likeCount",
          "replyCount",
          "retweetCount",
          "quoteCount",
          "mentionCount",
          "profileViewCount",
          "tweetClickCount",
          "dwellTimeMs",
          "addressBookCount",
          "directMessageCount",
          "coEngagementCount",
          "contentAffinityCount",
          "muteCount",
          "blockCount",
          "reportCount",
      },
      field);
  for (const auto key : keys) {
    (void)require_finite_number(
        required(value, std::string(key).c_str()),
        std::string(field) + "." + std::string(key));
  }
}

void validate_optional_epoch(const nlohmann::json& value, const std::string_view field) {
  if (value.is_null()) {
    return;
  }
  (void)require_safe_integer(value, field);
}

Cursor parse_cursor(const nlohmann::json& json) {
  require_exact_keys(
      json,
      {"generationId", "afterSourceUserId", "afterTargetUserId", "afterEdgeId"},
      "cursor");
  auto cursor = Cursor{
      .generation_id = require_non_blank_string(required(json, "generationId"), "cursor.generationId"),
      .after_source_user_id = require_non_blank_string(
          required(json, "afterSourceUserId"),
          "cursor.afterSourceUserId"),
      .after_target_user_id = require_non_blank_string(
          required(json, "afterTargetUserId"),
          "cursor.afterTargetUserId"),
      .after_edge_id = require_non_blank_string(required(json, "afterEdgeId"), "cursor.afterEdgeId"),
  };
  validate_generation_id(cursor.generation_id);
  return cursor;
}

Manifest parse_manifest(const nlohmann::json& json) {
  require_exact_keys(
      json,
      {
          "generationId",
          "status",
          "edgeCount",
          "canonicalSha256",
          "createdAt",
          "contentVersion",
          "diagnostic",
      },
      "manifest");
  auto manifest = Manifest{
      .generation_id = require_non_blank_string(required(json, "generationId"), "manifest.generationId"),
      .content_version = require_non_blank_string(
          required(json, "contentVersion"),
          "manifest.contentVersion"),
      .status = require_non_blank_string(required(json, "status"), "manifest.status"),
      .edge_count = require_safe_size(required(json, "edgeCount"), "manifest.edgeCount"),
      .canonical_sha256 = require_non_blank_string(
          required(json, "canonicalSha256"),
          "manifest.canonicalSha256"),
      .created_at_ms = static_cast<std::int64_t>(
          require_safe_integer(required(json, "createdAt"), "manifest.createdAt")),
      .diagnostic = std::nullopt,
  };
  if (json.contains("diagnostic")) {
    manifest.diagnostic = require_non_blank_string(json.at("diagnostic"), "manifest.diagnostic");
  }
  validate_generation_id(manifest.generation_id);
  if (manifest.status != "ready") {
    invalid("manifest.status must be ready");
  }
  if (manifest.canonical_sha256.size() != 64 || !is_lower_hex(manifest.canonical_sha256)) {
    invalid("manifest.canonicalSha256 must be 64 lowercase hex characters");
  }
  if (manifest.generation_id.substr(kGenerationPrefix.size()) != manifest.canonical_sha256) {
    invalid("manifest generationId does not match canonicalSha256");
  }
  if (manifest.content_version != "sha256:" + manifest.canonical_sha256) {
    invalid("manifest contentVersion does not match canonicalSha256");
  }
  return manifest;
}

Edge parse_edge(const nlohmann::json& json) {
  require_exact_keys(
      json,
      {
          "sourceUserId",
          "targetUserId",
          "edgeId",
          "decayedSum",
          "interactionProbability",
          "dailySignalCounts",
          "rollupSignalCounts",
          "edgeKinds",
          "lastInteractionAtMs",
          "updatedAtMs",
      },
      "edge");
  (void)require_non_blank_string(required(json, "sourceUserId"), "edge.sourceUserId");
  (void)require_non_blank_string(required(json, "targetUserId"), "edge.targetUserId");
  const auto edge_id = require_non_blank_string(required(json, "edgeId"), "edge.edgeId");
  if (require_finite_number(required(json, "decayedSum"), "edge.decayedSum") < 0.0) {
    invalid("edge.decayedSum must be non-negative");
  }
  (void)require_finite_number(
      required(json, "interactionProbability"),
      "edge.interactionProbability");
  validate_signal_counts(required(json, "dailySignalCounts"), "edge.dailySignalCounts");
  validate_signal_counts(required(json, "rollupSignalCounts"), "edge.rollupSignalCounts");
  const auto& edge_kinds = required(json, "edgeKinds");
  if (!edge_kinds.is_array()) {
    invalid("edge.edgeKinds must be an array");
  }
  for (const auto& kind : edge_kinds) {
    (void)require_non_blank_string(kind, "edge.edgeKinds[]");
  }
  validate_optional_epoch(required(json, "lastInteractionAtMs"), "edge.lastInteractionAtMs");
  validate_optional_epoch(required(json, "updatedAtMs"), "edge.updatedAtMs");

  auto record_json = json;
  record_json.erase("edgeId");
  return Edge{
      .edge_id = edge_id,
      .record = record_json.get<contracts::SnapshotEdgeRecord>(),
  };
}

Page parse_page(const nlohmann::json& envelope) {
  require_exact_keys(envelope, {"success", "data"}, "envelope");
  const auto& success = required(envelope, "success");
  if (!success.is_boolean() || !success.get<bool>()) {
    invalid("envelope.success must be true");
  }
  const auto& data = required(envelope, "data");
  require_exact_keys(
      data,
      {"generationId", "leaseId", "expiresAt", "manifest", "edges", "nextCursor", "done"},
      "data");

  auto page = Page{
      .generation_id = require_non_blank_string(required(data, "generationId"), "data.generationId"),
      .lease_id = require_non_blank_string(required(data, "leaseId"), "data.leaseId"),
      .expires_at_ms = static_cast<std::int64_t>(
          require_safe_integer(required(data, "expiresAt"), "data.expiresAt")),
      .manifest = parse_manifest(required(data, "manifest")),
      .edges = {},
      .next_cursor = std::nullopt,
      .done = false,
  };
  validate_generation_id(page.generation_id);
  if (page.generation_id != page.manifest.generation_id) {
    invalid("page and manifest generationId differ");
  }

  const auto& edges = required(data, "edges");
  if (!edges.is_array()) {
    invalid("data.edges must be an array");
  }
  page.edges.reserve(edges.size());
  for (const auto& edge : edges) {
    page.edges.push_back(parse_edge(edge));
  }

  const auto& next_cursor = required(data, "nextCursor");
  if (!next_cursor.is_null()) {
    page.next_cursor = parse_cursor(next_cursor);
  }
  const auto& done = required(data, "done");
  if (!done.is_boolean()) {
    invalid("data.done must be a boolean");
  }
  page.done = done.get<bool>();
  return page;
}

}  // namespace

struct CanonicalEdgeHasher::Impl {
  Impl()
      : context(EVP_MD_CTX_new()) {
    if (!context || EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) != 1) {
      throw std::runtime_error("initialize generation canonical SHA-256");
    }
  }

  std::unique_ptr<EVP_MD_CTX, EvpContextDeleter> context;
  bool finished{false};
};

CanonicalEdgeHasher::CanonicalEdgeHasher()
    : impl_(std::make_unique<Impl>()) {}

CanonicalEdgeHasher::~CanonicalEdgeHasher() = default;

void CanonicalEdgeHasher::update(const Edge& edge) {
  if (impl_->finished) {
    throw std::logic_error("generation canonical SHA-256 already finished");
  }
  auto canonical = serialize_canonical_edge(edge);
  canonical.push_back('\n');
  if (EVP_DigestUpdate(impl_->context.get(), canonical.data(), canonical.size()) != 1) {
    throw std::runtime_error("update generation canonical SHA-256");
  }
}

std::string CanonicalEdgeHasher::finish() {
  if (impl_->finished) {
    throw std::logic_error("generation canonical SHA-256 already finished");
  }
  std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
  unsigned int digest_size = 0;
  if (EVP_DigestFinal_ex(impl_->context.get(), digest.data(), &digest_size) != 1 ||
      digest_size != 32) {
    throw std::runtime_error("finish generation canonical SHA-256");
  }
  impl_->finished = true;

  constexpr char hex[] = "0123456789abcdef";
  std::string result;
  result.reserve(digest_size * 2);
  for (std::size_t index = 0; index < digest_size; ++index) {
    result.push_back(hex[digest[index] >> 4]);
    result.push_back(hex[digest[index] & 0x0f]);
  }
  return result;
}

nlohmann::json serialize_page_request(const PageRequest& request) {
  if (request.limit == 0 || request.limit > kMaxPageLimit) {
    invalid("request.limit out of range");
  }
  if (request.lease_id.has_value() != request.cursor.has_value()) {
    invalid("continuation requires leaseId and cursor together");
  }
  auto result = nlohmann::json{{"limit", request.limit}};
  if (!request.lease_id.has_value()) {
    return result;
  }
  const auto lease_id = require_non_blank_string(*request.lease_id, "request.leaseId");
  validate_generation_id(request.cursor->generation_id);
  result["leaseId"] = lease_id;
  result["cursor"] = nlohmann::json{
      {"generationId", request.cursor->generation_id},
      {"afterSourceUserId", request.cursor->after_source_user_id},
      {"afterTargetUserId", request.cursor->after_target_user_id},
      {"afterEdgeId", request.cursor->after_edge_id},
  };
  (void)parse_cursor(result.at("cursor"));
  return result;
}

nlohmann::json serialize_release_request(
    const std::string& generation_id,
    const std::string& lease_id) {
  validate_generation_id(generation_id);
  (void)require_non_blank_string(lease_id, "release.leaseId");
  return nlohmann::json{{"generationId", generation_id}, {"leaseId", lease_id}};
}

Page parse_page_envelope(const nlohmann::json& envelope) {
  try {
    return parse_page(envelope);
  } catch (const nlohmann::json::exception& error) {
    invalid(error.what());
  }
}

void validate_release_envelope(
    const nlohmann::json& envelope,
    const std::string& expected_generation_id,
    const std::string& expected_lease_id) {
  try {
    validate_generation_id(expected_generation_id);
    (void)require_non_blank_string(expected_lease_id, "expected leaseId");
    require_exact_keys(envelope, {"success", "data"}, "release envelope");
    const auto& success = required(envelope, "success");
    if (!success.is_boolean() || !success.get<bool>()) {
      invalid("release envelope.success must be true");
    }
    const auto& data = required(envelope, "data");
    require_exact_keys(data, {"generationId", "leaseId", "released"}, "release data");
    const auto generation_id =
        require_non_blank_string(required(data, "generationId"), "release generationId");
    const auto lease_id = require_non_blank_string(required(data, "leaseId"), "release leaseId");
    const auto& released = required(data, "released");
    if (!released.is_boolean() || !released.get<bool>()) {
      invalid("release data.released must be true");
    }
    if (generation_id != expected_generation_id || lease_id != expected_lease_id) {
      invalid("release response identity mismatch");
    }
  } catch (const nlohmann::json::exception& error) {
    invalid(error.what());
  }
}

}  // namespace telegram::graph::snapshot::generation
