#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
#include <thread>

#include <curl/curl.h>

#include "config/config.h"
#include "graph/graph_store.h"
#include "graph/realtime/redis_stream_consumer.h"
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
    if (config.internal_token.empty()) {
      std::cerr << "[graph-kernel] 告警：GRAPH_KERNEL_INTERNAL_TOKEN 未配置，当前以兼容模式放行入站请求，生产环境请配置内部鉴权密钥"
                << std::endl;
    }
    const auto outbound_token =
        !config.snapshot_internal_token.empty() ? config.snapshot_internal_token : config.internal_token;
    tg_core::GraphStore store;
    store.set_traversal_best_first_enabled(config.traversal_best_first_enabled);
    store.set_overlap_streaming_topk_enabled(config.overlap_streaming_topk_enabled);
    tg_ops::GraphServiceMetrics metrics;
    auto http_runtime_metrics = std::make_shared<tg_http::HttpRuntimeMetrics>();
    metrics.attach_http_runtime_metrics(http_runtime_metrics);
    auto v1_loader = std::make_unique<tg_snapshot::SnapshotLoader>(
        config,
        tg_snapshot::BackendSnapshotClient(
            config.backend_snapshot_url,
            outbound_token,
            config.backend_timeout_ms),
        store,
        metrics);
    std::unique_ptr<tg_snapshot::SnapshotRefresher> loader;
    if (config.snapshot_generation_v2_enabled) {
      auto v2_loader = std::make_unique<tg_snapshot::GenerationSnapshotLoader>(
          config.snapshot_page_size,
          config.max_neighbors_per_user,
          std::make_shared<tg_snapshot::BackendGenerationClient>(
              config.backend_snapshot_url,
              outbound_token,
              config.backend_timeout_ms),
          store,
          metrics);
      loader = std::make_unique<tg_snapshot::ResilientSnapshotLoader>(
          std::move(v2_loader),
          std::move(v1_loader));
    } else {
      loader = std::move(v1_loader);
    }

    try {
      loader->refresh_once();
      std::cout << "[graph-kernel] bootstrap snapshot loaded" << std::endl;
    } catch (const std::exception& error) {
      std::cerr << "[graph-kernel] bootstrap snapshot failed: " << error.what() << std::endl;
    }

    tg_core::realtime::RedisStreamConsumer stream_consumer(
        tg_core::realtime::RedisStreamConfig{
            .enabled = config.redis_stream_enabled,
            .url = config.redis_url,
            .host = config.redis_host,
            .port = config.redis_port,
            .password = config.redis_password,
            .stream_key = config.redis_stream_key,
            .consumer_group = config.redis_consumer_group,
            .consumer_name = config.redis_consumer_name,
        },
        store.delta_overlay());
    stream_consumer.start();

    std::jthread refresh_thread([&loader, &config](std::stop_token stop_token) {
      while (!stop_token.stop_requested()) {
        std::this_thread::sleep_for(std::chrono::seconds(config.snapshot_refresh_secs));
        if (stop_token.stop_requested()) break;
        try {
          loader->refresh_once();
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
    stream_consumer.stop();

    std::cout << "[graph-kernel] server exited cleanly" << std::endl;
  } catch (const std::exception& error) {
    std::cerr << "[graph-kernel] fatal: " << error.what() << std::endl;
    return 1;
  }

  return 0;
}
