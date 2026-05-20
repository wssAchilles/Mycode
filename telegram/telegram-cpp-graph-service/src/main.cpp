#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
#include <thread>

#include <curl/curl.h>

#include "config/config.h"
#include "graph/graph_store.h"
#include "http/graph_routes.h"
#include "http/http_server.h"
#include "http/runtime/runtime_metrics.h"
#include "ops/metrics.h"
#include "snapshot/backend_snapshot_client.h"
#include "snapshot/snapshot_loader.h"

namespace tg_config = telegram::graph::config;
namespace tg_core = telegram::graph::core;
namespace tg_http = telegram::graph::http;
namespace tg_ops = telegram::graph::ops;
namespace tg_snapshot = telegram::graph::snapshot;

namespace {

struct CurlGlobalGuard {
  CurlGlobalGuard() {
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != 0) {
      throw std::runtime_error("curl_global_init failed");
    }
  }
  ~CurlGlobalGuard() { curl_global_cleanup(); }
  CurlGlobalGuard(const CurlGlobalGuard&) = delete;
  CurlGlobalGuard& operator=(const CurlGlobalGuard&) = delete;
};

void signal_handler(int) {
  tg_http::HttpServer::request_shutdown();
}

}  // namespace

int main() {
  try {
    CurlGlobalGuard curl_guard;

    // Install signal handlers for graceful shutdown
    std::signal(SIGTERM, signal_handler);
    std::signal(SIGINT, signal_handler);

    const auto config = tg_config::load_from_env();
    tg_core::GraphStore store;
    tg_ops::GraphServiceMetrics metrics;
    auto http_runtime_metrics = std::make_shared<tg_http::HttpRuntimeMetrics>();
    metrics.attach_http_runtime_metrics(http_runtime_metrics);
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
            .metrics = http_runtime_metrics,
        });

    std::cout << "[graph-kernel] listening on " << config.bind_host << ':' << config.bind_port << std::endl;
    server.serve_forever();

    std::cout << "[graph-kernel] server exited cleanly" << std::endl;
  } catch (const std::exception& error) {
    std::cerr << "[graph-kernel] fatal: " << error.what() << std::endl;
    return 1;
  }

  return 0;
}
