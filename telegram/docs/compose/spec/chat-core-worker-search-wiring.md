---
feature: chat-core-worker-search-wiring
status: delivered
updated: 2026-07-16
branch: feat/worker-cron-auth
commits: af48ef9f..503f5a5d
---

# ChatCore Worker Search Modular Wiring

## Report

**What was built** — 生产入口仍为 `chatCore.worker.ts`（未切 `.new.ts`）。`searchMessages` 改为委托 `SearchBridge`：本地分层检索 + 远程 `/api/messages/search`（`targetId` 推导与原 monolith 一致）+ merge。远程请求注入 `Authorization`；init/shutdown 调用 `searchBridge.clearAll()`；去掉空结果指数退避。后端 `searchMessagesSchema` 修正为 `q`，与 controller/前端一致。

**Verification** — frontend `tsc --noEmit` PASS；`check:worker-first` **12/12 PASS**。独立 review 首轮 REQUEST_CHANGES（远程缺鉴权等），修复后复审 **APPROVE**。

**Journey log**

1. `chatCore.worker.new.ts` 大量 TODO，不可作生产入口；采用增量接线。
2. 首轮 SearchBridge 远程用裸 `fetch` 且发 `chatId`——鉴权与 `targetId` 均错；对照 monolith `deriveSearchTargetId` 与 `buildAuthHeaders` 修正。
3. schema 曾要求 `query` 而 FE/controller 用 `q`，远程搜索在接线前可能已 400；一并修 schema。
4. 空结果 backoff 会误伤合法 0 命中，按旧行为移除。
5. C4（worker 侧 write-only 索引）与 C5（归一化字段）留作后续；不阻塞本切片。

## [S1] Problem

Worker 单体内联搜索与已实现的 `SearchBridge` 双轨；生产路径未用模块，维护成本高。

## [S2] Design

- 保持 `chatCore.worker.ts` 入口。
- `searchMessages` → SearchBridge；远程带 token + `targetId`。
- init/shutdown `clearAll()`。
- 不改排序语义（以模块为准）；不切 `.new.ts`。

## [S3] Out of Scope

- 补全 `.new.ts` / 切换 workerBridge
- socket/sync/persistence 接线
- 双索引收敛与远程归一化字段增强

## Tasks

- [x] T1: SearchBridge 绑定并委托 searchMessages (covers: S2)
- [x] T2: 清理无引用内联搜索（在无引用前提下） (covers: S2; depends: T1)
- [x] T3: tsc + check:worker-first 绿 (covers: S2; depends: T2)
