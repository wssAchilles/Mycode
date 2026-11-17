#include "graph/realtime/delta_edge_overlay.h"

#include <algorithm>
#include <cmath>
#include <mutex>

namespace telegram::graph::core::realtime {
namespace {

std::int64_t steady_epoch_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}  // namespace

std::optional<DeltaEdgeOp> parse_delta_edge_op(const std::string& raw) {
  if (raw == "follow") return DeltaEdgeOp::Follow;
  if (raw == "unfollow") return DeltaEdgeOp::Unfollow;
  if (raw == "block") return DeltaEdgeOp::Block;
  if (raw == "unblock") return DeltaEdgeOp::Unblock;
  if (raw == "mute") return DeltaEdgeOp::Mute;
  if (raw == "unmute") return DeltaEdgeOp::Unmute;
  return std::nullopt;
}

void DeltaEdgeOverlay::apply_edge_delta(
    const EdgeDeltaEvent& event,
    const std::int64_t now_ms) {
  if (event.source_user_id.empty() || event.target_user_id.empty()) {
    return;
  }

  const auto effective_now = now_ms > 0 ? now_ms : steady_epoch_ms();
  std::unique_lock lock(mutex_);
  applied_events_ += 1;
  if (event.timestamp_ms > 0 && effective_now >= event.timestamp_ms) {
    last_event_lag_ms_ = effective_now - event.timestamp_ms;
  }

  switch (event.op) {
    case DeltaEdgeOp::Unfollow:
    case DeltaEdgeOp::Block:
    case DeltaEdgeOp::Mute: {
      blocked_targets_[event.source_user_id].insert(event.target_user_id);
      if (auto it = follow_boosts_.find(event.source_user_id); it != follow_boosts_.end()) {
        it->second.erase(event.target_user_id);
        if (it->second.empty()) {
          follow_boosts_.erase(it);
        }
      }
      const double penalty_step =
          event.op == DeltaEdgeOp::Block ? 0.35 :
          (event.op == DeltaEdgeOp::Mute ? 0.20 : 0.10);
      negative_penalty_[event.target_user_id] = std::min(
          1.0,
          negative_penalty_[event.target_user_id] + penalty_step);
      break;
    }
    case DeltaEdgeOp::Follow: {
      if (auto it = blocked_targets_.find(event.source_user_id); it != blocked_targets_.end()) {
        it->second.erase(event.target_user_id);
        if (it->second.empty()) {
          blocked_targets_.erase(it);
        }
      }
      const double w = std::isfinite(event.weight_delta) && event.weight_delta > 0.0
          ? event.weight_delta
          : 1.0;
      follow_boosts_[event.source_user_id][event.target_user_id] = BoostEntry{
          .weight = w,
          .timestamp_ms = event.timestamp_ms > 0 ? event.timestamp_ms : effective_now,
      };
      break;
    }
    case DeltaEdgeOp::Unblock:
    case DeltaEdgeOp::Unmute: {
      if (auto it = blocked_targets_.find(event.source_user_id); it != blocked_targets_.end()) {
        it->second.erase(event.target_user_id);
        if (it->second.empty()) {
          blocked_targets_.erase(it);
        }
      }
      break;
    }
  }
}

void DeltaEdgeOverlay::record_parse_error() {
  std::unique_lock lock(mutex_);
  parse_errors_ += 1;
}

std::unordered_set<std::string> DeltaEdgeOverlay::blocked_targets_for(
    const std::string& source_user_id) const {
  std::shared_lock lock(mutex_);
  auto it = blocked_targets_.find(source_user_id);
  if (it == blocked_targets_.end()) {
    return {};
  }
  return it->second;
}

std::unordered_map<std::string, double> DeltaEdgeOverlay::follow_boosts_for(
    const std::string& source_user_id) const {
  std::shared_lock lock(mutex_);
  auto it = follow_boosts_.find(source_user_id);
  if (it == follow_boosts_.end()) {
    return {};
  }
  std::unordered_map<std::string, double> result;
  result.reserve(it->second.size());
  for (const auto& [target_id, entry] : it->second) {
    result.emplace(target_id, entry.weight);
  }
  return result;
}

double DeltaEdgeOverlay::penalty_for_author(const std::string& author_id) const {
  std::shared_lock lock(mutex_);
  auto it = negative_penalty_.find(author_id);
  return it != negative_penalty_.end() ? it->second : 0.0;
}

void DeltaEdgeOverlay::prune_expired(const std::int64_t now_ms, const std::int64_t ttl_ms) {
  if (ttl_ms <= 0) return;
  std::unique_lock lock(mutex_);
  for (auto it = follow_boosts_.begin(); it != follow_boosts_.end();) {
    for (auto inner = it->second.begin(); inner != it->second.end();) {
      if (now_ms - inner->second.timestamp_ms > ttl_ms) {
        inner = it->second.erase(inner);
      } else {
        ++inner;
      }
    }
    if (it->second.empty()) {
      it = follow_boosts_.erase(it);
    } else {
      ++it;
    }
  }
}

DeltaOverlayMetricsSnapshot DeltaEdgeOverlay::metrics() const {
  std::shared_lock lock(mutex_);
  std::size_t blocked_count = 0;
  for (const auto& [_, targets] : blocked_targets_) {
    blocked_count += targets.size();
  }
  std::size_t boosted_count = 0;
  for (const auto& [_, targets] : follow_boosts_) {
    boosted_count += targets.size();
  }
  return DeltaOverlayMetricsSnapshot{
      .applied_events = applied_events_,
      .parse_errors = parse_errors_,
      .blocked_pair_count = blocked_count,
      .boosted_pair_count = boosted_count,
      .last_event_lag_ms = last_event_lag_ms_,
  };
}

}  // namespace telegram::graph::core::realtime
