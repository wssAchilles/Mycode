# Telegram C++ Graph Kernel

低延迟图数据面：只读快照上的邻居检索、桥接用户、共现与重叠计算。为 Rust Recommendation 与 Node Backend 提供 HTTP 查询。

## 职责

- 从 Node `/internal/graph-kernel/snapshot` 拉取图快照（v1 分页 / v2 generation + lease/cursor/sha256）
- 内存结构：StringInterner、CSR 邻接、best-first Frontier
- 原子快照切换：`shared_ptr` 双缓冲 publish / rollback，查询侧持旧引用
- HTTP：`/graph/batch` 及各类邻居/桥接/overlap 端点
- 诊断：`/health`、`/ready`、`/ops/graph`、`/metrics`

## 构建

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

要求：CMake ≥ 3.20，C++20，libcurl、nlohmann_json、OpenSSL、Threads。  
支持 ASAN/TSAN/UBSAN CMake option。Docker 使用 Alpine 多阶段构建（Alpine 下可能关闭 LTO）。

## 运行

```bash
# 环境变量见 deploy/vps/backend.env.example 中 GRAPH_KERNEL_* 
./build/graph_service   # 默认监听 0.0.0.0:4300（compose 内）
```

关键 env：

| 键 | 说明 |
| --- | --- |
| `GRAPH_KERNEL_BIND_ADDR` | 监听地址 |
| `GRAPH_KERNEL_BACKEND_SNAPSHOT_URL` | 快照源 |
| `GRAPH_KERNEL_SNAPSHOT_REFRESH_SECS` | 刷新周期 |
| `GRAPH_KERNEL_INTERNAL_TOKEN` | 内部鉴权 |
| `snapshot_generation_v2_enabled` 等 | loader 协议版本 |

## 查询 API（摘要）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/graph/batch` | socialNeighbors + recentEngagers + bridgeUsers + coEngagers + contentAffinityNeighbors |
| POST | `/graph/neighbors` 等 | 单类邻居 |
| POST | `/graph/multi-hop`、`/graph/bridge-users`、`/graph/author-candidates` | 多跳 / 桥接 / 作者候选 |
| POST | `/graph/overlap` | A/B 共同邻居 |
| GET | `/health`、`/ready`、`/ops/graph`、`/metrics` | 运维 |

响应统一带 `candidates` + `diagnostics`（snapshot_version、duration、budget_exhausted 等）。快照未加载时除 batch 外多返回 503。

## 目录

```text
src/
├── main.cpp
├── graph/                 # graph_store、snapshot、query/traversal
├── http/                  # 自研 http server + routes
├── snapshot/              # loader、backend client、generation protocol
└── config/
tests/                     # graph_store、snapshot_generation
benchmarks/                # 性能基线
```

## 门禁

```bash
bash scripts/verify/ci_verify_graph.sh
```

## 已知风险

- 自研 HTTP server 无 TLS；生产必须保持私网/localhost
- 快照替换期间需避免裸指针逃逸（当前路径以 `shared_ptr` 为准）
- 生产与本地 LTO/优化差异需用 bench 基线回归

## 相关文档

- [系统总览](../docs/architecture/system-overview.md)
- [跨服务契约](../docs/architecture/cross-service-contracts.md)
- [服务目录](../docs/architecture/service-catalog.md)
