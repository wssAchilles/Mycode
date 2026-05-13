#pragma once

#include <algorithm>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "contracts/types.h"

namespace telegram::graph::core::snapshot {

inline contracts::EdgeSignalCounts add_counts(
    contracts::EdgeSignalCounts left,
    const contracts::EdgeSignalCounts& right) {
  left.follow_count += right.follow_count;
  left.like_count += right.like_count;
  left.reply_count += right.reply_count;
  left.retweet_count += right.retweet_count;
  left.quote_count += right.quote_count;
  left.mention_count += right.mention_count;
  left.profile_view_count += right.profile_view_count;
  left.tweet_click_count += right.tweet_click_count;
  left.dwell_time_ms += right.dwell_time_ms;
  left.address_book_count += right.address_book_count;
  left.direct_message_count += right.direct_message_count;
  left.co_engagement_count += right.co_engagement_count;
  left.content_affinity_count += right.content_affinity_count;
  left.mute_count += right.mute_count;
  left.block_count += right.block_count;
  left.report_count += right.report_count;
  return left;
}

inline std::optional<std::int64_t> max_optional(
    const std::optional<std::int64_t>& left,
    const std::optional<std::int64_t>& right) {
  if (!left.has_value()) return right;
  if (!right.has_value()) return left;
  return std::max(left.value(), right.value());
}

inline void merge_edge_kinds(std::vector<std::string>& target, const std::vector<std::string>& source) {
  target.insert(target.end(), source.begin(), source.end());
  std::sort(target.begin(), target.end());
  target.erase(std::unique(target.begin(), target.end()), target.end());
}

inline std::vector<std::string> edge_kinds_from_record(const contracts::SnapshotEdgeRecord& edge) {
  std::vector<std::string> kinds = edge.edge_kinds;
  if (edge.rollup_signal_counts.follow_count > 0) {
    kinds.emplace_back("follow");
  }
  if (edge.rollup_signal_counts.address_book_count > 0 || edge.rollup_signal_counts.direct_message_count > 0) {
    kinds.emplace_back("chat_dm");
  }
  if (edge.rollup_signal_counts.reply_count > 0 || edge.rollup_signal_counts.mention_count > 0) {
    kinds.emplace_back("reply_mention");
  }
  if (edge.rollup_signal_counts.retweet_count > 0 || edge.rollup_signal_counts.quote_count > 0) {
    kinds.emplace_back("repost");
  }
  if (edge.rollup_signal_counts.like_count > 0) {
    kinds.emplace_back("like");
  }
  if (edge.daily_signal_counts.like_count > 0 || edge.daily_signal_counts.reply_count > 0 ||
      edge.daily_signal_counts.retweet_count > 0 || edge.daily_signal_counts.quote_count > 0 ||
      edge.daily_signal_counts.mention_count > 0 || edge.daily_signal_counts.direct_message_count > 0 ||
      edge.daily_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("recent_engagement");
  }
  if (edge.rollup_signal_counts.co_engagement_count > 0) {
    kinds.emplace_back("co_engagement");
  }
  if (edge.rollup_signal_counts.content_affinity_count > 0 || edge.rollup_signal_counts.profile_view_count > 0 ||
      edge.rollup_signal_counts.tweet_click_count > 0 || edge.rollup_signal_counts.dwell_time_ms > 0) {
    kinds.emplace_back("content_affinity");
  }

  std::sort(kinds.begin(), kinds.end());
  kinds.erase(std::unique(kinds.begin(), kinds.end()), kinds.end());
  return kinds;
}

}  // namespace telegram::graph::core::snapshot
