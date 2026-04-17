# Phase 23 Realtime Parity

Last updated: 2026-04-17

## Capability Owner

- `realtime owner = rust`
- `socket transport shim = node`
- `sync fallback owner = node`

## Completed

- [x] `telegram-rust-gateway/src/realtime/` 拆成 `contracts / ingress / fanout / state / ops / transport`
- [x] Rust 继续消费 `realtime.event.v1`，并新增消费 `realtime:delivery:v1`
- [x] Rust 根据 `socket / user / room / broadcast` 解析活跃连接目标
- [x] Rust 通过 `realtime:compat:dispatch:v1` 下发 resolved socket targets 给 Node compat shim
- [x] Node `socketService` 改成 `event publisher + compat transport shim + fallback emitter`
- [x] `/api/realtime/bootstrap` 支持双层 transport catalog:
  `preferred = rust_socket_io_compat`
  `fallback = node_socket_io_compat`
- [x] 前端 bootstrap parser 向后兼容 `socket_io_compat`，并保留 owner metadata
- [x] Rust `/gateway/ops/realtime` 新增 delivery lag / delivery drop / per-target emit / recent deliveries
- [x] Node `/api/ops/realtime` 新增 delivery bus summary 与 realtime owner runtime summary

## Remaining Controlled Gaps

- [ ] Node fallback hit 无法在 Redis 故障场景被 Rust 完整观测；当前以 Node ops 为准，Rust 侧字段仅保留接口位
- [ ] Rust 仍未直接终止 Socket.IO transport；当前模式是 `rust control-plane + node compat transport`
- [ ] 多实例 Node shard 语义尚未扩展；当前设计依赖单 VPS / 单 backend 实例

## Rollout Checks

- `GET /api/realtime/health`
  `transport.preferred = rust_socket_io_compat`
  `transport.fallback = node_socket_io_compat`
- `GET /api/ops/realtime`
  `runtime.realtimeOwner = rust`
  `deliveryBus.streamKey = realtime:delivery:v1`
- `GET /gateway/ops/realtime`
  `deliveryConsumerGroup = gateway-realtime-delivery`
  `deliveryCountsByTarget.socket|user|room|broadcast` 有值

## Verification

- [x] `cargo test --quiet` in `telegram-rust-gateway`
- [x] `npx tsc -p . --noEmit` in `telegram-clone-backend`
- [x] `vitest run tests/realtime/realtimeRoutes.test.ts` in `telegram-clone-backend`
- [x] `vitest --run src/test/realtimeBootstrap.test.ts` in `telegram-clone-frontend`
