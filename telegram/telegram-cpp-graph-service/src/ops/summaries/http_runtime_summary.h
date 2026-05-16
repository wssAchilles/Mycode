#pragma once

#include <memory>

#include <nlohmann/json.hpp>

#include "config/config.h"
#include "http/runtime/runtime_metrics.h"

namespace telegram::graph::ops::summaries {

nlohmann::json http_runtime_json(
    const config::ServiceConfig& config,
    const std::shared_ptr<http::HttpRuntimeMetrics>& metrics);

}  // namespace telegram::graph::ops::summaries
