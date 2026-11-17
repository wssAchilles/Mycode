#include "graph/realtime/redis_stream_consumer.h"

#include <atomic>
#include <chrono>
#include <cstring>
#include <iostream>

#include <nlohmann/json.hpp>

#ifdef HAVE_HIREDIS
#include <hiredis/hiredis.h>
#endif

namespace telegram::graph::core::realtime {

RedisConnectionSpec resolve_redis_connection_spec(const RedisStreamConfig& config) {
  RedisConnectionSpec spec{
      .host = config.host.empty() ? "127.0.0.1" : config.host,
      .port = config.port == 0 ? static_cast<std::uint16_t>(6379) : config.port,
      .password = config.password,
  };
  if (config.url.empty()) {
    return spec;
  }

  std::string rest = config.url;
  constexpr std::string_view kPrefix = "redis://";
  constexpr std::string_view kTlsPrefix = "rediss://";
  if (rest.starts_with(kPrefix)) {
    rest = rest.substr(kPrefix.size());
  } else if (rest.starts_with(kTlsPrefix)) {
    rest = rest.substr(kTlsPrefix.size());
  }

  const auto slash_pos = rest.find('/');
  if (slash_pos != std::string::npos) {
    rest.resize(slash_pos);
  }

  const auto at_pos = rest.rfind('@');
  if (at_pos != std::string::npos) {
    const auto auth = rest.substr(0, at_pos);
    rest = rest.substr(at_pos + 1);
    const auto colon_pos = auth.find(':');
    if (colon_pos != std::string::npos) {
      spec.password = auth.substr(colon_pos + 1);
    } else if (!auth.empty()) {
      spec.password = auth;
    }
  }

  const auto port_colon = rest.rfind(':');
  if (port_colon != std::string::npos) {
    spec.host = rest.substr(0, port_colon);
    try {
      spec.port = static_cast<std::uint16_t>(std::stoul(rest.substr(port_colon + 1)));
    } catch (const std::exception&) {
      // 保留默认端口
    }
  } else if (!rest.empty()) {
    spec.host = rest;
  }
  return spec;
}

bool apply_stream_record(
    const std::string& event_type,
    const std::string& payload_json,
    DeltaEdgeOverlay& overlay,
    const std::int64_t now_ms) {
  if (event_type != "graph.edge_delta") {
    return false;
  }

  try {
    const auto payload = nlohmann::json::parse(payload_json);
    const auto op = parse_delta_edge_op(payload.value("edgeOp", ""));
    const auto source = payload.value("sourceUserId", "");
    const auto target = payload.value("targetUserId", "");
    if (!op.has_value() || source.empty() || target.empty()) {
      overlay.record_parse_error();
      return false;
    }

    EdgeDeltaEvent event{
        .source_user_id = source,
        .target_user_id = target,
        .op = *op,
        .weight_delta = payload.value("weightDelta", 0.0),
        .timestamp_ms = payload.value("timestampMs", static_cast<std::int64_t>(0)),
    };
    overlay.apply_edge_delta(event, now_ms);
    return true;
  } catch (const std::exception&) {
    overlay.record_parse_error();
    return false;
  }
}

RedisStreamConsumer::RedisStreamConsumer(
    RedisStreamConfig config,
    std::shared_ptr<DeltaEdgeOverlay> overlay)
    : config_(std::move(config)), overlay_(std::move(overlay)) {}

RedisStreamConsumer::~RedisStreamConsumer() {
  stop();
}

void RedisStreamConsumer::start() {
  if (!config_.enabled || overlay_ == nullptr || worker_.joinable()) {
    return;
  }
  worker_ = std::jthread([this](std::stop_token token) { run_loop(token); });
}

void RedisStreamConsumer::stop() {
  if (worker_.joinable()) {
    worker_.request_stop();
    worker_.join();
  }
  connected_.store(false, std::memory_order_relaxed);
}

bool RedisStreamConsumer::is_connected() const noexcept {
  return connected_.load(std::memory_order_relaxed);
}

void RedisStreamConsumer::run_loop(std::stop_token stop_token) {
#ifdef HAVE_HIREDIS
  const auto spec = resolve_redis_connection_spec(config_);
  while (!stop_token.stop_requested()) {
    timeval timeout{2, 0};
    redisContext* ctx = redisConnectWithTimeout(spec.host.c_str(), static_cast<int>(spec.port), timeout);
    if (ctx == nullptr || ctx->err != 0) {
      connected_.store(false, std::memory_order_relaxed);
      if (ctx != nullptr) {
        redisFree(ctx);
      }
      std::this_thread::sleep_for(std::chrono::seconds(2));
      continue;
    }

    if (!spec.password.empty()) {
      auto* auth_reply = static_cast<redisReply*>(
          redisCommand(ctx, "AUTH %s", spec.password.c_str()));
      if (auth_reply == nullptr || auth_reply->type == REDIS_REPLY_ERROR) {
        if (auth_reply != nullptr) freeReplyObject(auth_reply);
        redisFree(ctx);
        connected_.store(false, std::memory_order_relaxed);
        std::this_thread::sleep_for(std::chrono::seconds(2));
        continue;
      }
      freeReplyObject(auth_reply);
    }

    // 幂等创建消费组（BUSYGROUP 视为正常已就绪）
    auto* grp_reply = static_cast<redisReply*>(redisCommand(
        ctx,
        "XGROUP CREATE %s %s $ MKSTREAM",
        config_.stream_key.c_str(),
        config_.consumer_group.c_str()));
    if (grp_reply != nullptr) {
      freeReplyObject(grp_reply);
    }

    connected_.store(true, std::memory_order_relaxed);
    std::cout << "[graph-kernel] hiredis stream consumer connected to "
              << spec.host << ':' << spec.port
              << " stream=" << config_.stream_key << std::endl;

    while (!stop_token.stop_requested()) {
      auto* reply = static_cast<redisReply*>(redisCommand(
          ctx,
          "XREADGROUP GROUP %s %s COUNT 64 BLOCK 500 STREAMS %s >",
          config_.consumer_group.c_str(),
          config_.consumer_name.c_str(),
          config_.stream_key.c_str()));

      if (reply == nullptr) {
        connected_.store(false, std::memory_order_relaxed);
        break;
      }

      if (reply->type == REDIS_REPLY_ARRAY && reply->elements > 0) {
        for (std::size_t s = 0; s < reply->elements; ++s) {
          const redisReply* stream_elem = reply->element[s];
          if (stream_elem == nullptr || stream_elem->elements < 2) continue;
          const redisReply* entries = stream_elem->element[1];
          if (entries == nullptr || entries->type != REDIS_REPLY_ARRAY) continue;

          for (std::size_t i = 0; i < entries->elements; ++i) {
            const redisReply* entry = entries->element[i];
            if (entry == nullptr || entry->elements < 2 || entry->element[0]->str == nullptr) continue;
            const std::string msg_id(entry->element[0]->str, entry->element[0]->len);
            const redisReply* kv = entry->element[1];
            if (kv == nullptr || kv->type != REDIS_REPLY_ARRAY) continue;

            std::string event_type;
            std::string payload_json;
            for (std::size_t f = 0; f + 1 < kv->elements; f += 2) {
              const auto* k_elem = kv->element[f];
              const auto* v_elem = kv->element[f + 1];
              if (!k_elem->str || !v_elem->str) continue;
              const std::string key(k_elem->str, k_elem->len);
              if (key == "eventType") {
                event_type.assign(v_elem->str, v_elem->len);
              } else if (key == "payload") {
                payload_json.assign(v_elem->str, v_elem->len);
              }
            }

            if (!event_type.empty() && !payload_json.empty()) {
              apply_stream_record(event_type, payload_json, *overlay_);
            }
            auto* ack_reply = static_cast<redisReply*>(redisCommand(
                ctx,
                "XACK %s %s %s",
                config_.stream_key.c_str(),
                config_.consumer_group.c_str(),
                msg_id.c_str()));
            if (ack_reply != nullptr) freeReplyObject(ack_reply);
          }
        }
      }
      freeReplyObject(reply);
    }

    redisFree(ctx);
    connected_.store(false, std::memory_order_relaxed);
    if (!stop_token.stop_requested()) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
  }
#else
  (void)stop_token;
  connected_.store(false, std::memory_order_relaxed);
#endif
}

}  // namespace telegram::graph::core::realtime
