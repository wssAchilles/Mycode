# Telegram Rust Gateway

实时与入口边界（Realtime Edge）：对 Node Backend 的全量反向代理，叠加分级限流、JWT 预校验、实时协议兼容与可切换的 Socket 终结。

**不在** `telegram-rust-workspace` 内，独立 `Cargo.lock` 与 Dockerfile。

## 职责

- HTTP：`ANY /*` 反代到 `GATEWAY_UPSTREAM_HTTP`（默认 `http://backend:5000`）
- 限流：按 `TrafficClass × client_ip` 的令牌桶
- 鉴权：HS256 JWT 预校验（`aud=telegram-clone-users`，`iss=telegram-clone`）；InternalOps/Auth/PublicRead/SocketIoCompat 可旁路
- 实时：Redis Streams ingress/delivery/DLQ + Socket.IO 兼容事件面
- Ops：`/gateway/ops/{control-plane,ingress-policy,traffic,realtime}*`

## 启动

```bash
cargo run --release
# 或 Docker；监听 GATEWAY_BIND_ADDR，默认 0.0.0.0:4000
```

入口：`src/main.rs`（jemalloc 分配器，非 MSVC）。

## 路由

| 路径 | 说明 |
| --- | --- |
| `GET /health` | 探活 |
| `GET /gateway/ops/*` | 控制面 / 限流 / 实时摘要 |
| `ANY /`、`ANY /{*path}` | 反代 Node |

Socket.IO layer 仅在 `realtime_socket_terminator == rust` 时挂载。

## 实时 rollout

| 开关 | 值 | 含义 |
| --- | --- | --- |
| `GATEWAY_REALTIME_ROLLOUT_STAGE` | `shadow` / `compat_primary` / `rust_edge_primary` | 边界阶段 |
| `GATEWAY_REALTIME_SOCKET_TERMINATOR` | `node` / `rust` | Socket 由谁终结（仅 rust_edge_primary 生效） |

当前生产基线：`rust_edge_primary` + terminator `node`（Phase 23 / 2A）。

Streams：

- ingress：`realtime:ingress:v1`（group `gateway-realtime-boundary`）
- delivery：`realtime:delivery:v1`（group `gateway-realtime-delivery`）
- DLQ：`realtime:dlq:v1`
- 兼容派发：`realtime:compat:dispatch:v1`

业务上游仍是 Node（`/api/auth/me`、发消息、已读、群组）；Rust 负责连接生命周期与事件桥。

## 目录

```text
src/
├── main.rs
├── config.rs
├── auth/jwt.rs
├── http/proxy_handler.rs
├── ingress/               # rate_limit、traffic_policy、request_context
├── realtime/
│   ├── contracts/         # realtime.event/delivery/compat.dispatch v1
│   ├── socket/            # server + upstream
│   ├── fanout/
│   └── transport/         # compat_dispatch
└── core/bootstrap.rs      # control plane 播种
```

## 门禁

```bash
cargo test --manifest-path telegram-rust-gateway/Cargo.toml
```

基线：`benchmarks/realtime_gateway_baseline.json`。

## 已知风险

- 默认 API 桶按 IP，多实例无全局配额
- 与 workspace 的依赖版本可能漂移（独立 lockfile）
- 控制面 mutex poison 多用 `expect`，中毒会 panic 而非降级

## 相关文档

- [运行时开关](../docs/architecture/runtime-switches.md)
- [阶段状态](../docs/architecture/phase-status.md)
- [跨服务契约](../docs/architecture/cross-service-contracts.md)
