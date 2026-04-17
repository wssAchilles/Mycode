#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

namespace telegram::graph::contracts {

struct SnapshotEdgeRecord {
  std::string source_user_id;
  std::string target_user_id;
  double decayed_sum;
  double interaction_probability;
  std::optional<std::string> last_interaction_at;
  std::optional<std::string> updated_at;
};

struct SnapshotPagePayload {
  std::vector<SnapshotEdgeRecord> edges;
  std::size_t offset;
  std::size_t limit;
  std::optional<std::size_t> next_offset;
  bool done;
};

struct NeighborCandidate {
  std::string user_id;
  double score;
  std::optional<double> interaction_probability;
};

struct MultiHopCandidate {
  std::string user_id;
  double score;
  std::size_t depth;
  std::size_t path_count;
  std::vector<std::string> via_user_ids;
};

struct OverlapCandidate {
  std::string user_id;
  double combined_score;
  double user_a_score;
  double user_b_score;
};

struct ErrorPayload {
  std::string code;
  std::string message;
};

inline void from_json(const nlohmann::json& json, SnapshotEdgeRecord& record) {
  record.source_user_id = json.at("sourceUserId").get<std::string>();
  record.target_user_id = json.at("targetUserId").get<std::string>();
  record.decayed_sum = json.at("decayedSum").get<double>();
  record.interaction_probability = json.value("interactionProbability", 0.0);
  if (json.contains("lastInteractionAt") && !json.at("lastInteractionAt").is_null()) {
    record.last_interaction_at = json.at("lastInteractionAt").get<std::string>();
  }
  if (json.contains("updatedAt") && !json.at("updatedAt").is_null()) {
    record.updated_at = json.at("updatedAt").get<std::string>();
  }
}

inline void to_json(nlohmann::json& json, const NeighborCandidate& candidate) {
  json = nlohmann::json{
      {"userId", candidate.user_id},
      {"score", candidate.score},
  };
  if (candidate.interaction_probability.has_value()) {
    json["interactionProbability"] = candidate.interaction_probability.value();
  }
}

inline void to_json(nlohmann::json& json, const MultiHopCandidate& candidate) {
  json = nlohmann::json{
      {"userId", candidate.user_id},
      {"score", candidate.score},
      {"depth", candidate.depth},
      {"pathCount", candidate.path_count},
      {"viaUserIds", candidate.via_user_ids},
  };
}

inline void to_json(nlohmann::json& json, const OverlapCandidate& candidate) {
  json = nlohmann::json{
      {"userId", candidate.user_id},
      {"combinedScore", candidate.combined_score},
      {"userAScore", candidate.user_a_score},
      {"userBScore", candidate.user_b_score},
  };
}

inline nlohmann::json success_response(const nlohmann::json& data) {
  return nlohmann::json{{"success", true}, {"data", data}};
}

inline nlohmann::json error_response(const ErrorPayload& error) {
  return nlohmann::json{
      {"success", false},
      {"error", {{"code", error.code}, {"message", error.message}}},
  };
}

}  // namespace telegram::graph::contracts
