---
feature: cron-secret-auth-hardening
status: designed
updated: 2026-07-16
branch: feat/worker-cron-auth
commits: 
---

# CRON_SECRET Auth Hardening

## Report

## [S1] Problem

`authenticateToken` treats a matching `CRON_SECRET` Bearer token as a full user bypass (`system-crawler`) on **every** authenticated route (`/api/space`, `/api/news`, `/api/ml`, uploads, etc.). Intended use is ML/cron callbacks (news ingest). A leaked secret grants broad API access.

## [S2] Design

1. **Remove** the global `CRON_SECRET` bypass from `authenticateToken`.
2. **Add** `requireCronSecret` middleware:
   - Accept secret from header `x-cron-secret` only (not query string).
   - Timing-safe compare against `process.env.CRON_SECRET`.
   - Missing env or mismatch → 401.
   - On success set `req.userId = 'system-crawler'` and a minimal `req.user` for logging continuity.
3. **Mount** only on `POST /api/news/ingest` (the documented cron/ML ingest path).
4. Other `/api/news/*` routes continue to use `authenticateToken`.

**Contracts:**

- User JWT paths unchanged.
- Cron callers must switch from `Authorization: Bearer $CRON_SECRET` to `x-cron-secret: $CRON_SECRET` for ingest only.
- No new dependencies.

## [S3] Out of Scope

- Rotating secrets / secret manager integration
- Rate limiting cron endpoints
- Changing light-jobs or ml-services callers beyond documenting the header

## Tasks

- [ ] T1: Add requireCronSecret middleware + unit tests — acceptance: missing/wrong secret 401; correct secret sets system-crawler (covers: S2)
- [ ] T2: Remove global bypass; wire ingest route — acceptance: authenticateToken rejects CRON_SECRET as Bearer; POST /api/news/ingest accepts x-cron-secret (covers: S2; depends: T1)
- [ ] T3: Backend vitest for auth + news ingest path green; tsc green (covers: S2; depends: T2)
