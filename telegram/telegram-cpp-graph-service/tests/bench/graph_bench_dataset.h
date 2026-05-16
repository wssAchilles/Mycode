#pragma once

#include <string>
#include <vector>

#include "contracts/types.h"

namespace telegram::graph::tests::bench {

inline contracts::SnapshotEdgeRecord edge(
    const std::string& source,
    const std::string& target,
    const double score) {
  contracts::SnapshotEdgeRecord record;
  record.source_user_id = source;
  record.target_user_id = target;
  record.decayed_sum = score;
  record.interaction_probability = score;
  record.rollup_signal_counts.reply_count = score * 10.0;
  record.rollup_signal_counts.co_engagement_count = score * 4.0;
  record.rollup_signal_counts.content_affinity_count = score * 3.0;
  record.daily_signal_counts.like_count = score * 2.0;
  record.edge_kinds = {"bench"};
  return record;
}

inline std::vector<contracts::SnapshotEdgeRecord> build_edges() {
  std::vector<contracts::SnapshotEdgeRecord> edges;
  edges.reserve(70000);
  for (int index = 0; index < 20000; ++index) {
    const auto score = static_cast<double>((index % 1000) + 1) / 1000.0;
    edges.push_back(edge("u-root", "u-" + std::to_string(index), score));
  }
  for (int source = 0; source < 600; ++source) {
    for (int target = 0; target < 64; ++target) {
      const auto score = static_cast<double>(((source + 1) * (target + 3)) % 997) / 997.0;
      edges.push_back(edge("u-" + std::to_string(source), "hop-" + std::to_string(target), score));
    }
  }
  for (int index = 0; index < 5000; ++index) {
    const auto target = "shared-" + std::to_string(index);
    edges.push_back(edge("u-overlap-a", target, 0.4));
    edges.push_back(edge("u-overlap-b", target, 0.6));
  }
  return edges;
}

}  // namespace telegram::graph::tests::bench
