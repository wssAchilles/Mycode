#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <thread>

#include "graph/realtime/delta_edge_overlay.h"

namespace telegram::graph::core::realtime {

struct RedisStreamConfig {
  bool enabled{false};
  std::string url;
  std::string host{"127.0.0.1"};
  std::uint16_t port{6379};
  std::string password;
  std::string stream_key{"recsys:events:v1"};
  std::string consumer_group{"cpp-graph-kernel"};
  std::string consumer_name{"cpp-graph-worker-1"};
};

struct RedisConnectionSpec {
  std::string host{"127.0.0.1"};
  std::uint16_t port{6379};
  std::string password;
};

/**
 * 解析 redis://[:password@]host[:port] 或回退至显式 host/port/password 配置
 */
RedisConnectionSpec resolve_redis_connection_spec(const RedisStreamConfig& config);

/**
 * 将来自 Redis Stream `recsys:events:v1` 的单条事件应用至 DeltaEdgeOverlay（供消费者与单测复用）
 */
bool apply_stream_record(
    const std::string& event_type,
    const std::string& payload_json,
    DeltaEdgeOverlay& overlay,
    std::int64_t now_ms = 0);

/**
 * 基于 hiredis XREADGROUP 的后台实时流消费者线程管理类
 */
class RedisStreamConsumer {
 public:
  RedisStreamConsumer(
      RedisStreamConfig config,
      std::shared_ptr<DeltaEdgeOverlay> overlay);
  ~RedisStreamConsumer();

  RedisStreamConsumer(const RedisStreamConsumer&) = delete;
  RedisStreamConsumer& operator=(const RedisStreamConsumer&) = delete;

  void start();
  void stop();

  bool is_connected() const noexcept;

 private:
  void run_loop(std::stop_token stop_token);

  RedisStreamConfig config_;
  std::shared_ptr<DeltaEdgeOverlay> overlay_;
  std::jthread worker_;
  std::atomic<bool> connected_{false};
};

}  // namespace telegram::graph::core::realtime
