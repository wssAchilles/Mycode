#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "contracts/types.h"
#include "graph/domain/weighted_neighbor.h"

namespace telegram::graph::core::query {

using WeightedNeighbor = domain::WeightedNeighbor;

inline double clamp_non_negative(const double value) {
  return std::max(0.0, value);
}

inline double positive_engagement(const contracts::EdgeSignalCounts& counts) {
  return counts.follow_count * 4.0 + counts.reply_count * 3.0 + counts.mention_count * 2.5 +
         counts.like_count * 1.0 + counts.retweet_count * 1.5 + counts.quote_count * 1.8 +
         counts.profile_view_count * 0.2 + counts.tweet_click_count * 0.1 + counts.address_book_count * 2.0 +
         counts.direct_message_count * 2.6 + counts.co_engagement_count * 2.4 +
         counts.content_affinity_count * 1.7 + counts.dwell_time_ms * 0.0005;
}

inline double negative_penalty(const contracts::EdgeSignalCounts& counts) {
  return counts.mute_count * 4.0 + counts.block_count * 8.0 + counts.report_count * 6.0;
}

inline double follow_bonus(const contracts::EdgeSignalCounts& counts) {
  return (counts.follow_count > 0 ? 2.0 : 0.0) + (counts.address_book_count > 0 ? 0.8 : 0.0);
}

inline double co_engagement_signal(const contracts::EdgeSignalCounts& counts) {
  return counts.co_engagement_count * 3.2 + counts.reply_count * 1.0 + counts.like_count * 0.5 +
         counts.retweet_count * 0.8 + counts.quote_count * 0.9 + counts.mention_count * 0.6;
}

inline double content_affinity_signal(const contracts::EdgeSignalCounts& counts) {
  return counts.content_affinity_count * 2.8 + counts.profile_view_count * 0.45 +
         counts.tweet_click_count * 0.35 + counts.dwell_time_ms * 0.0011;
}

inline double direct_message_signal(const contracts::EdgeSignalCounts& counts) {
  return counts.direct_message_count * 2.0 + counts.address_book_count * 0.9;
}

// Accepts a pre-computed now_ms to avoid repeated system_clock::now() calls
// in hot loops (e.g., rank_neighbors iterating thousands of neighbors).
inline double recentness_signal_at(
    const std::optional<std::int64_t>& last_interaction_at_ms,
    std::int64_t now_ms) {
  if (!last_interaction_at_ms.has_value()) {
    return 0.0;
  }
  const auto elapsed_ms = std::max<std::int64_t>(0, now_ms - last_interaction_at_ms.value());
  const auto elapsed_days = static_cast<double>(elapsed_ms) / (1000.0 * 60.0 * 60.0 * 24.0);
  return std::exp(-elapsed_days / 7.0);
}

inline double recentness_signal(const std::optional<std::int64_t>& last_interaction_at_ms) {
  if (!last_interaction_at_ms.has_value()) {
    return 0.0;
  }

  const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::system_clock::now().time_since_epoch())
                          .count();
  return recentness_signal_at(last_interaction_at_ms, now_ms);
}

inline double normalized_weight_at(const WeightedNeighbor& neighbor, const std::int64_t now_ms) {
  const auto base_score = clamp_non_negative(neighbor.score) * 0.6;
  const auto probability_score = clamp_non_negative(neighbor.interaction_probability) * 0.15;
  const auto engagement_score =
      std::min(1.5, positive_engagement(neighbor.rollup_signal_counts) / 20.0) * 0.2;
  const auto recency_score = recentness_signal_at(neighbor.last_interaction_at_ms, now_ms) * 0.05;
  const auto penalty = std::min(0.45, negative_penalty(neighbor.rollup_signal_counts) * 0.02);
  return std::max(0.0, base_score + probability_score + engagement_score + recency_score - penalty);
}

inline double normalized_weight(const WeightedNeighbor& neighbor) {
  return normalized_weight_at(
      neighbor,
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

inline double social_weight_at(const WeightedNeighbor& neighbor, const std::int64_t now_ms) {
  const auto engagement_score = positive_engagement(neighbor.rollup_signal_counts);
  const auto relation_score = follow_bonus(neighbor.rollup_signal_counts) +
                              neighbor.rollup_signal_counts.reply_count * 0.8 +
                              neighbor.rollup_signal_counts.mention_count * 0.5 +
                              direct_message_signal(neighbor.rollup_signal_counts) * 0.2;
  const auto recency_score = recentness_signal_at(neighbor.last_interaction_at_ms, now_ms);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      neighbor.score * 0.55 + neighbor.interaction_probability * 0.15 +
          std::min(3.0, engagement_score / 12.0) + relation_score + recency_score * 0.5 - penalty);
}

inline double social_weight(const WeightedNeighbor& neighbor) {
  return social_weight_at(
      neighbor,
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

inline double recent_engager_weight_at(const WeightedNeighbor& neighbor, const std::int64_t now_ms) {
  const auto recency = recentness_signal_at(neighbor.last_interaction_at_ms, now_ms);
  const auto daily_engagement =
      neighbor.daily_signal_counts.reply_count * 2.0 + neighbor.daily_signal_counts.mention_count * 1.5 +
      neighbor.daily_signal_counts.like_count * 0.6 + neighbor.daily_signal_counts.tweet_click_count * 0.15 +
      neighbor.daily_signal_counts.direct_message_count * 1.6 +
      neighbor.daily_signal_counts.co_engagement_count * 1.4 + neighbor.daily_signal_counts.dwell_time_ms * 0.0008;
  const auto rollup_engagement = positive_engagement(neighbor.rollup_signal_counts);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      recency * 2.0 + std::min(2.0, daily_engagement / 5.0) + std::min(2.0, rollup_engagement / 15.0) +
          neighbor.score * 0.25 + neighbor.interaction_probability * 0.15 - penalty);
}

inline double recent_engager_weight(const WeightedNeighbor& neighbor) {
  return recent_engager_weight_at(
      neighbor,
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

inline double co_engager_weight_at(const WeightedNeighbor& neighbor, const std::int64_t now_ms) {
  const auto co_signal = co_engagement_signal(neighbor.rollup_signal_counts) +
      co_engagement_signal(neighbor.daily_signal_counts) * 0.55;
  const auto recency = recentness_signal_at(neighbor.last_interaction_at_ms, now_ms);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.18;
  return std::max(
      0.0,
      neighbor.score * 0.35 + neighbor.interaction_probability * 0.15 + std::min(4.0, co_signal / 5.0) +
          recency * 0.7 - penalty);
}

inline double co_engager_weight(const WeightedNeighbor& neighbor) {
  return co_engager_weight_at(
      neighbor,
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

inline double content_affinity_weight_at(const WeightedNeighbor& neighbor, const std::int64_t now_ms) {
  const auto affinity_signal = content_affinity_signal(neighbor.rollup_signal_counts) +
      content_affinity_signal(neighbor.daily_signal_counts) * 0.45;
  const auto recency = recentness_signal_at(neighbor.last_interaction_at_ms, now_ms);
  const auto penalty = negative_penalty(neighbor.rollup_signal_counts) * 0.15;
  return std::max(
      0.0,
      neighbor.score * 0.3 + neighbor.interaction_probability * 0.1 + std::min(4.0, affinity_signal / 4.0) +
          direct_message_signal(neighbor.rollup_signal_counts) * 0.1 + recency * 0.4 - penalty);
}

inline double content_affinity_weight(const WeightedNeighbor& neighbor) {
  return content_affinity_weight_at(
      neighbor,
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
}

inline std::vector<std::string> relation_kinds(const WeightedNeighbor& neighbor) {
  std::vector<std::string> kinds = neighbor.edge_kinds;
  if (neighbor.rollup_signal_counts.follow_count > 0) kinds.emplace_back("follow");
  if (neighbor.rollup_signal_counts.address_book_count > 0 ||
      neighbor.rollup_signal_counts.direct_message_count > 0) {
    kinds.emplace_back("chat_dm");
  }
  if (neighbor.rollup_signal_counts.reply_count > 0) kinds.emplace_back("reply");
  if (neighbor.rollup_signal_counts.mention_count > 0) kinds.emplace_back("mention");
  if (neighbor.rollup_signal_counts.like_count > 0) kinds.emplace_back("like");
  if (neighbor.rollup_signal_counts.retweet_count > 0 || neighbor.rollup_signal_counts.quote_count > 0) {
    kinds.emplace_back("share");
  }
  if (neighbor.rollup_signal_counts.profile_view_count > 0 ||
      neighbor.rollup_signal_counts.tweet_click_count > 0) {
    kinds.emplace_back("interest");
  }
  if (neighbor.daily_signal_counts.reply_count > 0 || neighbor.daily_signal_counts.like_count > 0 ||
      neighbor.daily_signal_counts.mention_count > 0 || neighbor.daily_signal_counts.direct_message_count > 0 ||
      neighbor.daily_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("recent_activity");
  }
  if (neighbor.rollup_signal_counts.co_engagement_count > 0) kinds.emplace_back("co_engagement");
  if (neighbor.rollup_signal_counts.content_affinity_count > 0) kinds.emplace_back("content_affinity");

  std::sort(kinds.begin(), kinds.end());
  kinds.erase(std::unique(kinds.begin(), kinds.end()), kinds.end());
  return kinds;
}

inline double bridge_strength(const contracts::MultiHopCandidate& candidate) {
  const auto via_diversity = std::log1p(static_cast<double>(candidate.via_user_ids.size()));
  const auto path_density = std::log1p(static_cast<double>(candidate.path_count));
  const auto depth_discount = 1.0 / static_cast<double>(candidate.depth + 1);
  return candidate.score * (1.0 + via_diversity * 0.35 + path_density * 0.25) * depth_discount;
}

}  // namespace telegram::graph::core::query
