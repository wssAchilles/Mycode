---
feature: cron-secret-auth-hardening
status: delivered
updated: 2026-07-16
branch: feat/worker-cron-auth
commits: af48ef9f..503f5a5d
---

# CRON_SECRET Auth Hardening

## Report

**What was built** — 移除 `authenticateToken` 上的全局 `CRON_SECRET` Bearer 旁路；新增 timing-safe 的 `requireCronSecret`（仅 `x-cron-secret` header），只挂在 `POST /api/news/ingest`。`telegram-light-jobs` 与 `ml-services` 的 news_fetcher 改为发送该 header，避免 ingest 401。其余 `/api/news/*` 仍走 JWT。

**Verification** — backend `tsc --noEmit` PASS；`vitest tests/middleware tests/news` **19/19 PASS**（含 bypass 移除、header 401、ingest 路由）。独立 review + 复审 **APPROVE**。

**Journey log**

1. 全局 Bearer 旁路可打任意 authenticateToken 路由，收紧为 ingest 专用 header。
2. 调用方原用 `?token=` / `Authorization: Bearer`，若不改会静默 401——与安全改动同分支落地。
3. 比较使用 sha256 定长摘要 + `timingSafeEqual`；未配置 env 一律 401。

## [S1] Problem

`authenticateToken` 将匹配 `CRON_SECRET` 的 Bearer 令牌提升为 `system-crawler`，作用于所有受保护路由，泄漏即全面越权。

## [S2] Design

- 删除全局 bypass。
- `requireCronSecret`：仅 `x-cron-secret`；SHA-256 + `timingSafeEqual`；缺配置/缺头/不匹配 → 401。
- 仅 `POST /api/news/ingest` 使用该中间件。
- 调用方（light-jobs、ml-services news_fetcher）改发 `x-cron-secret`。

## [S3] Out of Scope

- Secret 轮换 / secret manager
- Cron 端点限流
- light-jobs 自身入站鉴权（`jobs/http/auth.py` 仍用 Bearer，与 backend ingest 无关）

## Tasks

- [x] T1: requireCronSecret + 单测 — timing-safe、401 路径 (covers: S2)
- [x] T2: 移除全局 bypass；ingest 挂载 — authenticateToken 拒绝 CRON Bearer (covers: S2; depends: T1)
- [x] T3: 后端 vitest + tsc 绿 (covers: S2; depends: T2)
