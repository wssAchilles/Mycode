# 运行时开关与回退

完整键位以 `deploy/vps/backend.env.example` 为准。本文按 **故障场景** 组织，便于值班回退。

## 1. 回退决策表

| 症状 | 先查 | 回退动作 | 风险 |
| --- | --- | --- | --- |
| 消息不达 / 投递积压 | Go `/ops/summary`、DLQ 长度、canary mismatch | `DELIVERY_EXECUTION_MODE=rollback_node`（或关闭 go_primary rollout） | Node 同步 fanout，大群可能打爆进程 |
| 实时连接异常 | Gateway `/gateway/ops/realtime`、Node `/api/ops/realtime` | `GATEWAY_REALTIME_SOCKET_TERMINATOR=node`；必要时 stage=`compat_primary` | 丢失 Rust edge 限流/观测路径 |
| 推荐空页 / 超时 / 契约违约 | Node feed 日志、`/ops/recommendation/summary`、fallback rate | `RUST_RECOMMENDATION_MODE=shadow` 或 `off` | 回落 Node baseline，算法能力下降 |
| 图召回失败 | Graph `/ready`、`/ops/graph`、快照 generation | `CPP_GRAPH_KERNEL_ENABLED=false` | 依赖 Node/Rust 其他 source 顶上 |
| ML 超时 / 模型未加载 | Cloud Run `/health`、ARTIFACT_VERSION | 关闭模型 scorer 或依赖 Node 降级路径；必要时切 `serving-lite` profile | 排序质量下降 |
| 平台事件不派发 | Go platform replay summary、handler mode | 将对应 `DELIVERY_CONSUMER_*_EXECUTION_MODE=publish`；未知 topic 走 replay drain | 回放需人工 drain |

## 2. 关键开关分组

### 2.1 投递

```dotenv
DELIVERY_EXECUTION_MODE=go_primary          # go_primary | rollback_node | ...
DELIVERY_CONSUMER_EXECUTION_MODE=primary    # primary | shadow | dry-run
DELIVERY_GO_PRIMARY_PRIVATE_ENABLED=true
DELIVERY_GO_PRIMARY_GROUP_ENABLED=true
DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT=100
DELIVERY_GO_PRIMARY_GROUP_ROLLOUT_PERCENT=100
DELIVERY_CONSUMER_PRIMARY_MAX_ATTEMPTS=3
```

### 2.2 实时

```dotenv
GATEWAY_REALTIME_ROLLOUT_STAGE=rust_edge_primary   # shadow | compat_primary | rust_edge_primary
GATEWAY_REALTIME_SOCKET_TERMINATOR=node            # node | rust
GATEWAY_RATE_LIMIT_CAPACITY=120
GATEWAY_RATE_LIMIT_REFILL_PER_SEC=2
GATEWAY_REQUEST_TIMEOUT_SECS=30
GATEWAY_SYNC_REQUEST_TIMEOUT_SECS=45
```

### 2.3 推荐

```dotenv
RUST_RECOMMENDATION_MODE=shadow            # off | shadow | primary
RUST_RECOMMENDATION_TIMEOUT_MS=9000
RUST_RECOMMENDATION_STAGE=retrieval_ranking_v2
RUST_RECOMMENDATION_SELECTOR_OVERSAMPLE_FACTOR=5
RUST_RECOMMENDATION_SELECTOR_MAX_SIZE=200
RECOMMENDATION_INTERNAL_TOKEN=change-me
```

### 2.4 图核

```dotenv
CPP_GRAPH_KERNEL_ENABLED=true
CPP_GRAPH_KERNEL_TIMEOUT_MS=1200
CPP_GRAPH_KERNEL_URL=http://graph_kernel:4300
GRAPH_KERNEL_SNAPSHOT_REFRESH_SECS=300
GRAPH_KERNEL_INTERNAL_TOKEN=change-me
```

### 2.5 平台事件 handler

```dotenv
DELIVERY_CONSUMER_SYNC_WAKE_EXECUTION_MODE=publish
DELIVERY_CONSUMER_PRESENCE_EXECUTION_MODE=publish
DELIVERY_CONSUMER_NOTIFICATION_EXECUTION_MODE=publish
```

非 `publish` 时 handler 返回 Shadowed 并进入平台回放队列。

## 3. 安全相关开关（不可弱化）

| 键 | 要求 |
| --- | --- |
| `JWT_SECRET` | 强随机；仅 secret 注入 |
| `OPS_METRICS_TOKEN` | 变更默认 `change-me` |
| `DELIVERY_CONSUMER_INTERNAL_TOKEN` | drain 等 ops 必需 |
| `RECOMMENDATION_INTERNAL_TOKEN` | 建议配置；未配置时 Rust 侧放行 |
| `GRAPH_KERNEL_INTERNAL_TOKEN` | 快照与查询面 |
| `CRON_SECRET` | jobs 鉴权；Node 中可绕过用户认证，必须网络隔离 + 强密钥 |

## 4. 配置漂移防护

1. 改 env 后同步更新 `backend.env.example` 注释与 [phase-status.md](phase-status.md)。
2. 多维开关（Delivery mode × handler mode）变更必须在 dry-run/shadow 验证后再 primary。
3. 发布使用 `release_backend.sh` dry-run → gate → promote；不要手工 ssh 改 env 后不入库。
4. 回滚优先切换 `/opt/telegram/current` 软链 + compose up，而不是现场改生产 env 语义。

## 5. 前端运行时开关（客户端）

位置：`telegram-clone-frontend/src/core/chat/runtimeFlags.ts` + `rolloutPolicy.ts`

| 域 | 说明 |
| --- | --- |
| `storageBackend` | 默认 `sqlite-opfs`；可回退 idb |
| `syncGapRecover*` | gap recovery 冷却/抖动/强制预算 |
| WASM baseline | `strictWorkerBaseline` 要求 wasm + seqOps/searchTiered |
| 分桶发布 | FNV-1a(userId) → baseline / canary / safe；支持 emergency safe mode |

前端开关随构建或本地标志生效，与服务端 env 独立。
