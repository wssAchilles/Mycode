#pragma once

#include <cstdint>

#include <nlohmann/json.hpp>

#include "graph/snapshot/metadata.h"

namespace telegram::graph::ops::summaries {

nlohmann::json snapshot_payload_json(
    const core::SnapshotMetadata& metadata,
    const nlohmann::json& loaded_at,
    std::uint64_t snapshot_age_secs);

nlohmann::json snapshot_summary_fields_json(
    const core::SnapshotMetadata& metadata,
    std::uint64_t snapshot_age_secs);

}  // namespace telegram::graph::ops::summaries
