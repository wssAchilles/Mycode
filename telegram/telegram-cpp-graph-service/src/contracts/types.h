#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace telegram::graph::contracts {

struct EdgeSignalCounts {
  double follow_count{0.0};
  double like_count{0.0};
  double reply_count{0.0};
  double retweet_count{0.0};
  double quote_count{0.0};
  double mention_count{0.0};
  double profile_view_count{0.0};
  double tweet_click_count{0.0};
  double dwell_time_ms{0.0};
  double address_book_count{0.0};
  double direct_message_count{0.0};
  double co_engagement_count{0.0};
  double content_affinity_count{0.0};
  double mute_count{0.0};
  double block_count{0.0};
  double report_count{0.0};
};

struct SnapshotEdgeRecord {
  std::string source_user_id;
  std::string target_user_id;
  double decayed_sum;
  double interaction_probability;
  EdgeSignalCounts daily_signal_counts;
  EdgeSignalCounts rollup_signal_counts;
  std::vector<std::string> edge_kinds;
  std::optional<std::int64_t> last_interaction_at_ms;
  std::optional<std::int64_t> updated_at_ms;
};

struct SnapshotPagePayload {
  std::vector<SnapshotEdgeRecord> edges;
  std::size_t offset;
  std::size_t limit;
  std::optional<std::size_t> next_offset;
  bool done;
  std::string snapshot_version;
};

struct NeighborCandidate {
  std::string user_id;
  double score;
  std::optional<double> interaction_probability;
  std::optional<double> engagement_score;
  std::optional<double> recentness_score;
  std::vector<std::string> relation_kinds;
};

struct MultiHopCandidate {
  std::string user_id;
  double score;
  std::size_t depth;
  std::size_t path_count;
  std::vector<std::string> via_user_ids;
};

struct BridgeCandidate {
  std::string user_id;
  double score;
  std::size_t depth;
  std::size_t path_count;
  std::vector<std::string> via_user_ids;
  double bridge_strength;
  std::size_t via_user_count;
};

struct OverlapCandidate {
  std::string user_id;
  double combined_score;
  double user_a_score;
  double user_b_score;
};

struct GraphQueryDiagnostics {
  std::string kernel;
  std::uint64_t query_duration_ms;
  std::size_t candidate_count;
  bool empty;
  std::optional<std::string> empty_reason;
  std::vector<std::string> relation_kinds;
};

struct ErrorPayload {
  std::string code;
  std::string message;
};

inline EdgeSignalCounts parse_signal_counts(const nlohmann::json& json) {
  return EdgeSignalCounts{
      .follow_count = json.value("followCount", 0.0),
      .like_count = json.value("likeCount", 0.0),
      .reply_count = json.value("replyCount", 0.0),
      .retweet_count = json.value("retweetCount", 0.0),
      .quote_count = json.value("quoteCount", 0.0),
      .mention_count = json.value("mentionCount", 0.0),
      .profile_view_count = json.value("profileViewCount", 0.0),
      .tweet_click_count = json.value("tweetClickCount", 0.0),
      .dwell_time_ms = json.value("dwellTimeMs", 0.0),
      .address_book_count = json.value("addressBookCount", 0.0),
      .direct_message_count = json.value("directMessageCount", 0.0),
      .co_engagement_count = json.value("coEngagementCount", 0.0),
      .content_affinity_count = json.value("contentAffinityCount", 0.0),
      .mute_count = json.value("muteCount", 0.0),
      .block_count = json.value("blockCount", 0.0),
      .report_count = json.value("reportCount", 0.0),
  };
}

inline void from_json(const nlohmann::json& json, SnapshotEdgeRecord& record) {
  record.source_user_id = json.at("sourceUserId").get<std::string>();
  record.target_user_id = json.at("targetUserId").get<std::string>();
  record.decayed_sum = json.at("decayedSum").get<double>();
  record.interaction_probability = json.value("interactionProbability", 0.0);
  if (json.contains("dailySignalCounts") && json.at("dailySignalCounts").is_object()) {
    record.daily_signal_counts = parse_signal_counts(json.at("dailySignalCounts"));
  }
  if (json.contains("rollupSignalCounts") && json.at("rollupSignalCounts").is_object()) {
    record.rollup_signal_counts = parse_signal_counts(json.at("rollupSignalCounts"));
  }
  if (json.contains("edgeKinds") && json.at("edgeKinds").is_array()) {
    record.edge_kinds = json.at("edgeKinds").get<std::vector<std::string>>();
  }
  if (json.contains("lastInteractionAtMs") && !json.at("lastInteractionAtMs").is_null()) {
    record.last_interaction_at_ms = json.at("lastInteractionAtMs").get<std::int64_t>();
  }
  if (json.contains("updatedAtMs") && !json.at("updatedAtMs").is_null()) {
    record.updated_at_ms = json.at("updatedAtMs").get<std::int64_t>();
  }
}

inline void to_json(nlohmann::json& json, const NeighborCandidate& candidate) {
  json = nlohmann::json{
      {"userId", candidate.user_id},
      {"score", candidate.score},
      {"relationKinds", candidate.relation_kinds},
  };
  if (candidate.interaction_probability.has_value()) {
    json["interactionProbability"] = candidate.interaction_probability.value();
  }
  if (candidate.engagement_score.has_value()) {
    json["engagementScore"] = candidate.engagement_score.value();
  }
  if (candidate.recentness_score.has_value()) {
    json["recentnessScore"] = candidate.recentness_score.value();
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

inline void to_json(nlohmann::json& json, const BridgeCandidate& candidate) {
  json = nlohmann::json{
      {"userId", candidate.user_id},
      {"score", candidate.score},
      {"depth", candidate.depth},
      {"pathCount", candidate.path_count},
      {"viaUserIds", candidate.via_user_ids},
      {"bridgeStrength", candidate.bridge_strength},
      {"viaUserCount", candidate.via_user_count},
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

inline void to_json(nlohmann::json& json, const GraphQueryDiagnostics& diagnostics) {
  json = nlohmann::json{
      {"kernel", diagnostics.kernel},
      {"queryDurationMs", diagnostics.query_duration_ms},
      {"candidateCount", diagnostics.candidate_count},
      {"empty", diagnostics.empty},
      {"relationKinds", diagnostics.relation_kinds},
  };
  if (diagnostics.empty_reason.has_value()) {
    json["emptyReason"] = diagnostics.empty_reason.value();
  }
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
