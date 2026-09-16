# 架构文档

本目录记录 **as-built** 系统架构与跨服务契约，作为 README 与各服务 README 之上的总览层。

| 文档 | 内容 |
| --- | --- |
| [system-overview.md](system-overview.md) | 逻辑架构、运行时拓扑、能力归属、关键数据路径 |
| [service-catalog.md](service-catalog.md) | 服务清单：语言、端口、健康检查、依赖、镜像 |
| [cross-service-contracts.md](cross-service-contracts.md) | Redis Streams / PubSub、HTTP 内部 API、实时协议 |
| [phase-status.md](phase-status.md) | 各能力线当前 phase 与灰度状态（统一索引） |
| [runtime-switches.md](runtime-switches.md) | 关键运行时开关、回退路径与推荐默认值 |

## 维护原则

- 以仓库内代码与 `deploy/vps/backend.env.example` 为真相来源；文档与代码冲突时以代码为准并回写文档。
- 阶段编号在不同能力线之间历史上互相独立；新阶段请在 [phase-status.md](phase-status.md) 登记，避免只改 env 注释。
- 算法语义变更仍受根目录 `AGENTS.md` 的 Algorithm Research Gate 约束，本目录不替代研究门禁。
