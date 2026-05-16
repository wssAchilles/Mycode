#include "ops/summaries/http_runtime_summary.h"

namespace telegram::graph::ops::summaries {

nlohmann::json http_runtime_json(
    const config::ServiceConfig& config,
    const std::shared_ptr<http::HttpRuntimeMetrics>& metrics) {
  const auto snapshot = metrics == nullptr ? http::HttpRuntimeSnapshot{} : metrics->snapshot();
  return nlohmann::json{
      {"configuredWorkers", config.http_worker_count},
      {"configuredQueueCapacity", config.http_queue_capacity},
      {"configuredMaxConnections", config.http_max_connections},
      {"requestTimeoutSecs", config.http_request_timeout_secs},
      {"maxBodyBytes", config.http_max_body_bytes},
      {"acceptedConnections", snapshot.accepted_connections},
      {"rejectedConnections", snapshot.rejected_connections},
      {"requestTimeouts", snapshot.request_timeouts},
      {"bodyTooLarge", snapshot.body_too_large},
      {"invalidRequests", snapshot.invalid_requests},
      {"internalErrors", snapshot.internal_errors},
      {"activeConnections", snapshot.active_connections},
      {"activeWorkers", snapshot.active_workers},
      {"queueDepth", snapshot.queue_depth},
      {"maxQueueDepth", snapshot.max_queue_depth},
  };
}

}  // namespace telegram::graph::ops::summaries
