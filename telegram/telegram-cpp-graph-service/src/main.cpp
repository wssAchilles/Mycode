#include <chrono>
#include <iostream>
#include <thread>

#include <curl/curl.h>

#include "config/config.h"
#include "graph/graph_store.h"
#include "http/graph_routes.h"
#include "http/http_server.h"
#include "ops/metrics.h"
#include "snapshot/backend_snapshot_client.h"
#include "snapshot/snapshot_loader.h"

namespace tg_config = telegram::graph::config;
namespace tg_core = telegram::graph::core;
namespace tg_http = telegram::graph::http;
namespace tg_ops = telegram::graph::ops;
namespace tg_snapshot = telegram::graph::snapshot;

int main() {
  try {
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != 0) {
      std::cerr << "[graph-kernel] fatal: curl_global_init failed" << std::endl;
      return 1;
    }

    const auto config = tg_config::load_from_env();
    tg_core::GraphStore store;
    tg_ops::GraphServiceMetrics metrics;
    tg_snapshot::SnapshotLoader loader(
        config,
        tg_snapshot::BackendSnapshotClient(
            config.backend_snapshot_url,
            config.internal_token,
            config.backend_timeout_ms),
        store,
        metrics);

    try {
      loader.refresh_once();
      std::cout << "[graph-kernel] bootstrap snapshot loaded" << std::endl;
    } catch (const std::exception& error) {
      std::cerr << "[graph-kernel] bootstrap snapshot failed: " << error.what() << std::endl;
    }

    std::jthread refresh_thread([&loader, &config](std::stop_token stop_token) {
      while (!stop_token.stop_requested()) {
        std::this_thread::sleep_for(std::chrono::seconds(config.snapshot_refresh_secs));
        if (stop_token.stop_requested()) break;
        try {
          loader.refresh_once();
          std::cout << "[graph-kernel] snapshot refreshed" << std::endl;
        } catch (const std::exception& error) {
          std::cerr << "[graph-kernel] snapshot refresh failed: " << error.what() << std::endl;
        }
      }
    });

    tg_http::HttpServer server(
        config.bind_host,
        config.bind_port,
        tg_http::make_graph_handler(config, store, metrics),
        tg_http::HttpServerOptions{
            .max_connections = config.http_max_connections,
            .worker_count = config.http_worker_count,
            .queue_capacity = config.http_queue_capacity,
            .request_timeout_secs = config.http_request_timeout_secs,
            .max_body_bytes = config.http_max_body_bytes,
        });

    std::cout << "[graph-kernel] listening on " << config.bind_host << ':' << config.bind_port << std::endl;
    server.serve_forever();
  } catch (const std::exception& error) {
    std::cerr << "[graph-kernel] fatal: " << error.what() << std::endl;
    return 1;
  }

  curl_global_cleanup();
  return 0;
}
