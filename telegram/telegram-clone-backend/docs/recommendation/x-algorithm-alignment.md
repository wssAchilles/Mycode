# 推荐系统 x-algorithm 对标边界

本文记录 Space 推荐系统对标 `xai-org/x-algorithm` 公开架构思想后的本地边界。目标不是照搬实现，而是固定 owner、候选管线、反馈归因和回放口径。

## 架构映射

| x-algorithm 概念 | 本项目组件 | Owner |
| --- | --- | --- |
| Home Mixer | Space feed runtime (`/api/space/feed`) | Node route + Rust primary |
| CandidatePipeline | `telegram-rust-recommendation` pipeline executor | Rust |
| Thunder-like in-network | in-network timeline / recent author candidate source | Rust source stage + Node provider hydration |
| Phoenix-like OON ranking | Phoenix scorer + weighted multi-action score | Rust scorer stage |
| Selector | top-k / soft cap / exploration pool | Rust selector stage |
| Side effects | `RecommendationTrace` + `UserAction` + `UserSignal` | Backend observability/analytics |

## Owner 规则

- Rust 是长期推荐算法 owner，负责 filters、scorers、selectors、serving、side effects stage detail。
- Node provider 只负责 query hydration、candidate hydration、sources provider 和迁移期 fallback baseline。
- `SpaceFeedMixer` 仅作为 fallback/baseline，不承载新的长期 scorer/filter/selector 能力。
- Candidate serving 响应使用最终 served 顺序生成 1-based rank，不使用 pre-selector 排名。

## Serving 契约

`POST /api/space/feed` 的 `posts[]` 默认保留轻量、稳定的候选归因字段：

- `_recommendationRequestId`
- `_recommendationRank`
- `_recommendationScore`
- `_weightedScore`
- `_recallSource`
- `_selectionPool`
- `_selectionReason`

完整 `_recommendationTrace`、`_scoreBreakdown` 和 `_pipelineScore` 继续受 debug 开关保护，避免生产响应膨胀。

## 反馈闭环

前端 analytics metadata 必须能写入 `UserAction`：

- `requestId`
- 1-based `rank`
- `score`
- `recallSource`
- `selectionPool`
- `selectionReason`
- `productSurface = space_feed`

负反馈统一进入推荐信号集合：`dismiss`、`hide`、`report`、`block`、`mute`。非法 post id、空 user id 或异常 metadata 只跳过对应事件，不阻断同 batch 的其他有效事件。

## Replay / Eval 口径

离线回放用 `requestId + rank + postId` 串联三类数据：

- `RecommendationTrace`：曝光序列、source、score、selector pool/reason。
- `UserAction`：后续 click、dwell、like、dismiss、report 等标签。
- feed response：线上 served rank 和稳定解释字段。

导出脚本需要保留 `rank`、`recallSource`、`score`、`weightedScore`、`selectionPool`、`selectionReason`，方便按 selector pool、召回来源和反馈标签做切片分析。

## 演进规则

- 新增模型或启发式前，先确认字段进入 replay/eval，而不是只影响线上排序。
- Phoenix-like 多目标分数缺失时，在 debug/summary 中标记缺口，不伪造模型能力。
- In-network 请求优先保证低延迟、稳定 rank、served dedup 和 direct fallback。
- Out-of-network 继续以 Phoenix/weighted/final score 分层为主，selector 只消费 final score。
