# Telegram Go Delivery Consumer

可回放的平台投递执行面：消费 Redis Streams，写 Mongo 投递投影，发布 wake / presence / notification，并提供 DLQ、canary、回放与 ops HTTP。

## 职责

- 消费 `chat:delivery:bus:v1`（消息 fanout）与 `platform:events:v1`（平台事件）
- Primary 模式：chunk 级幂等写 Mongo（`chatmemberstates` / `updatecounters` / `updatelogs` / `chatdeliveryoutboxes`）
- 失败分类：Handled / QueueRetry / Terminal；毒消息进 DLQ
- 平台回放 worker：消费 `platform:events:replay:v1`，支持手动 drain
- Ops：`/health`、`/ops/summary`、`/ops/platform/replay/summary`、`POST /ops/platform/replay/drain`

## 启动

```bash
# 依赖：Go 1.x、Redis、MongoDB
go run ./cmd/delivery-consumer
```

装配入口：`cmd/delivery-consumer/main.go`  
四 goroutine：consumer.Run、replayWorker.Run、httpServer、profilingServer。

## 消费状态机

```text
Spawning → Connecting → EnsuringGroup → DrainingPEL → Running → Draining → Stopped
```

- 启动先 `XGROUP CREATE MKSTREAM`（容忍 BUSYGROUP），再从 id=0 排空本 consumer 的 PEL
- 循环：XAutoClaim 认领超时 pending → XReadGroup（投递流 + 平台流）→ 并行 Dispatch → 批量 ACK → 周期性 XTrim

## 执行模式

| 层级 | 值 | 说明 |
| --- | --- | --- |
| Consumer | `primary` / `shadow` / dry-run | 总开关 |
| Platform handler | `publish` / shadow | syncwake、presence、notification 各自独立 |

非 publish 的平台 handler 会标记 Shadowed 并写入回放流。

## 目录

```text
cmd/delivery-consumer/     # main
internal/
├── config/                # stream key、集合、默认值
├── streamconsumer/        # 运行循环、delivery/platform handlers、reclaim、recovery
├── primary/               # Mongo fanout 执行器与投影
├── platform/              # dispatcher + syncwake/presence/notification + replay
├── dlq/                   # 毒消息写入
├── canary/                # canary 记账
├── shadow/                # shadow 对照
├── contracts/             # envelope 与 payload
├── http/                  # ops server
└── observability/         # OTel / pprof
```

## 默认 Stream Key

| 用途 | Key |
| --- | --- |
| 投递主总线 | `chat:delivery:bus:v1` |
| 投递 DLQ | `chat:delivery:bus:dlq:v1` |
| Canary | `chat:delivery:canary:v1` |
| 平台事件 | `platform:events:v1` |
| 平台 DLQ / 回放 | `platform:events:dlq:v1` / `platform:events:replay:v1` |
| Wake | `sync:update:wake:v1` |
| Presence / 通知 | `user:online`、`user:offline`、`notification` |

## 门禁

```bash
bash scripts/verify/go_default.sh
```

## 已知缺口

- Delivery DLQ 只写不自动回放
- 回放 completed hash 无 TTL，长期可能增长
- 并发 consumer 同 outbox 的竞态依赖 Mongo 原子更新与索引

## 相关文档

- [跨服务契约](../docs/architecture/cross-service-contracts.md)
- [运行时开关](../docs/architecture/runtime-switches.md)
- [阶段状态](../docs/architecture/phase-status.md)
