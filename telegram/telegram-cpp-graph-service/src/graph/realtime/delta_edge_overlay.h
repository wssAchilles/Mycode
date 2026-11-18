#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace telegram::graph::core::realtime {

enum class DeltaEdgeOp {
  Follow,
  Unfollow,
  Block,
  Unblock,
  Mute,
  Unmute,
};

std::optional<DeltaEdgeOp> parse_delta_edge_op(const std::string& raw);

struct EdgeDeltaEvent {
  std::string source_user_id;
  std::string target_user_id;
  DeltaEdgeOp op{DeltaEdgeOp::Unfollow};
  double weight_delta{0.0};
  std::int64_t timestamp_ms{0};
};

struct DeltaOverlayMetricsSnapshot {
  std::uint64_t applied_events{0};
  std::uint64_t parse_errors{0};
  std::size_t blocked_pair_count{0};
  std::size_t boosted_pair_count{0};
  std::int64_t last_event_lag_ms{0};
};

/**
 * 并发安全的图谱实时增量边叠加层：提供 <1ms 级断边屏蔽、新增关注与作者负反馈惩罚累加
 */
class DeltaEdgeOverlay {
 public:
  void apply_edge_delta(const EdgeDeltaEvent& event, std::int64_t now_ms = 0);
  void record_parse_error();

  std::unordered_set<std::string> blocked_targets_for(
      const std::string& source_user_id) const;

  std::unordered_map<std::string, double> follow_boosts_for(
      const std::string& source_user_id) const;

  double penalty_for_author(const std::string& author_id) const;

  void prune_expired(std::int64_t now_ms, std::int64_t ttl_ms);

  DeltaOverlayMetricsSnapshot metrics() const;

 private:
  struct BoostEntry {
    double weight{1.0};
    std::int64_t timestamp_ms{0};
  };

  struct PenaltyEntry {
    double penalty{0.0};
    std::int64_t updated_at_ms{0};
  };

  mutable std::shared_mutex mutex_;
  // 记录屏蔽目标及其事件时间戳，供快照刷新后按水位淘汰已吸收状态
  std::unordered_map<std::string, std::unordered_map<std::string, std::int64_t>> blocked_targets_;
  std::unordered_map<std::string, std::unordered_map<std::string, BoostEntry>> follow_boosts_;
  std::unordered_map<std::string, PenaltyEntry> negative_penalty_;
  std::uint64_t applied_events_{0};
  std::uint64_t parse_errors_{0};
  std::int64_t last_event_lag_ms_{0};
};

}  // namespace telegram::graph::core::realtime
