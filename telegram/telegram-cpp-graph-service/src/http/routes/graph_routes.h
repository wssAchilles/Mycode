#pragma once

#include "config/config.h"
#include "graph/graph_store.h"
#include "http/runtime/http_server.h"
#include "ops/metrics.h"

namespace telegram::graph::http {

HttpServer::Handler make_graph_handler(
    const config::ServiceConfig& config,
    core::GraphStore& store,
    ops::GraphServiceMetrics& metrics);

}  // namespace telegram::graph::http
