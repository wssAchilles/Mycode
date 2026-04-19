# VPS Deployment Baseline

This directory is the VPS deployment surface for the current multi-language production shape.

## Runtime layout

- `backend`: public API, auth, uploads, control-plane, fallback adapters
- `gateway`: Rust ingress and realtime edge
- `recommendation`: Rust recommendation orchestration
- `delivery_consumer`: Go platform bus and replay operator
- `graph_kernel`: C++ graph data plane
- `redis`: shared event/cache runtime
- `nginx`: host reverse proxy

## Engineering shape

- Keep Node on the public boundary and control plane.
- Keep Rust on low-latency request orchestration and realtime delivery.
- Keep Go on replayable platform-event execution.
- Keep C++ on graph retrieval kernels and snapshot diagnostics.
- Keep deployment checks capability-oriented instead of phase-oriented.

## Bootstrap

```bash
sudo bash deploy/vps/bootstrap_vps.sh
```

## Env preparation

```bash
cd deploy/vps
cp backend.env.example backend.env
```

Fill at least:

- `MONGODB_URI`
- `DATABASE_URL`
- `JWT_SECRET`
- `GEMINI_API_KEY`
- `FRONTEND_ORIGIN`
- `OPS_METRICS_TOKEN`

## Local VPS smoke

```bash
cd deploy/vps
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:4000/health
```

`docker-compose.yml` is the local build-first profile. Production should use `docker-compose.prod.yml` with GHCR images.

## Production release

Keep the real env file outside releases:

```bash
sudo mkdir -p /opt/telegram/shared
sudo cp deploy/vps/backend.env /opt/telegram/shared/backend.env
```

Publish a release from the repo:

```bash
REMOTE_ROOT=/opt/telegram RELEASE_ID=$(git rev-parse --short HEAD) \
deploy/vps/release_backend.sh deploy@your-server
```

If GHCR is private:

```bash
GHCR_USERNAME=your-github-user GHCR_TOKEN=ghp_xxx \
REMOTE_ROOT=/opt/telegram RELEASE_ID=$(git rev-parse --short HEAD) \
deploy/vps/release_backend.sh deploy@your-server
```

## Long-lived capability checks

Use these instead of phase-specific checks:

- `deploy/vps/check_realtime_readiness.sh`
- `deploy/vps/check_recommendation_readiness.sh`
- `deploy/vps/check_graph_readiness.sh`
- `deploy/vps/check_platform_replay_readiness.sh`

Examples:

```bash
bash deploy/vps/check_realtime_readiness.sh
bash deploy/vps/check_recommendation_readiness.sh
bash deploy/vps/check_graph_readiness.sh
bash deploy/vps/check_platform_replay_readiness.sh
```

Each script returns machine-readable JSON with:

- `capability`
- `owner`
- `currentBlocker`
- `recommendedAction`
- `runtimeMode`
- `capabilityMetrics`

## Main ops endpoints

- `GET /api/ops/realtime`
- `GET /api/ops/recommendation`
- `GET /api/ops/platform-bus`
- `GET /gateway/ops/realtime`
- `GET /ops/recommendation/summary`
- `GET /ops/graph`
- `GET /ops/platform/replay/summary`

## Release discipline

- Push images through GHCR first.
- Promote the VPS only after GHCR is green.
- Run capability checks after deploy.
- Finish with frontend smoke against `https://api.xuziqi.tech`.
- `config.stage = retrieval_ranking_v2`
- `rustRecommendation.summary.runtime.retrievalMode = source_orchestrated_graph_v2`
- `rustRecommendation.summary.runtime.rankingMode = phoenix_standardized`
- `rustRecommendation.summary.runtime.sourceOrder` populated with the explicit source execution order
- `rustRecommendation.summary.runtime.graphSourceEnabled = true`
- `runtime.lastShadowSummary.retrieval.graph.kernelSourceCounts` populated after feed requests
- `runtime.lastShadowSummary.retrieval.graph.dominantKernelSource` indicates whether social/recent/bridge dominated
- `graphKernel.snapshot.snapshotAgeSecs` remains within the expected refresh window
- `runtime.lastShadowSummary.ranking` populated with Phoenix-ranked candidate counts and ranking degraded reasons when applicable

Phase 7 upgrades the Go delivery consumer from pure dry-run observation to shadow execution. Node still owns production side effects, while Go now plans the same chunk topology, compares completed projection results, and dead-letters poisoned events without taking over the primary path.

Phase 8 enables the first Go canary execution segment. Keep Node as the primary fanout projector, but run the Go consumer in `canary` mode and set the backend rollout policy to `go_canary`. In this mode, Go still compares projection results and additionally writes low-risk `projection_bookkeeping` canary results to `chat:delivery:canary:v1`. This validates the primary execution lane and rollback thresholds without double-writing `ChatMemberState` or sync wakes.

Recommended Phase 8 VPS runtime values:

```bash
DELIVERY_EXECUTION_MODE=go_canary
DELIVERY_CONSUMER_EXECUTION_MODE=canary
DELIVERY_CONSUMER_CANARY_STREAM_KEY=chat:delivery:canary:v1
DELIVERY_CANARY_SEGMENT=projection_bookkeeping
DELIVERY_CANARY_MISMATCH_THRESHOLD=5
DELIVERY_CANARY_DLQ_THRESHOLD=3
DELIVERY_CONSUMER_CANARY_MISMATCH_THRESHOLD=5
DELIVERY_CONSUMER_CANARY_DLQ_THRESHOLD=3
```

Use `DELIVERY_EXECUTION_MODE=rollback_node` to force Node-owned execution if canary mismatch or DLQ counters drift.

Phase 9 adds guarded Go primary takeover for a tiny production segment. It is intentionally partial: Node still owns the default path, and Go only takes over private chats whose recipient count is at or below `DELIVERY_GO_PRIMARY_MAX_RECIPIENTS`. Group fanout stays disabled by default. When the gate is open, Node creates the durable outbox and publishes `fanout_requested`, but it does not enqueue BullMQ jobs for eligible segments. The Go consumer writes `ChatMemberState`, appends `UpdateLog` / `UpdateCounter`, publishes sync wake events, and completes the outbox.

Recommended Phase 9 guarded takeover values:

```bash
DELIVERY_EXECUTION_MODE=go_primary
DELIVERY_GO_PRIMARY_READY=true
DELIVERY_GO_PRIMARY_PRIVATE_ENABLED=true
DELIVERY_GO_PRIMARY_GROUP_ENABLED=false
DELIVERY_GO_PRIMARY_MAX_RECIPIENTS=2
DELIVERY_CONSUMER_EXECUTION_MODE=primary
DELIVERY_CONSUMER_MONGO_URL="${MONGODB_URI}"
DELIVERY_CONSUMER_MONGO_DATABASE=telegram
DELIVERY_CONSUMER_PRIMARY_MAX_ATTEMPTS=3
DELIVERY_CONSUMER_PROJECTION_CHUNK_SIZE=500
DELIVERY_CONSUMER_MEMBER_STATE_COLLECTION=chatmemberstates
DELIVERY_CONSUMER_UPDATE_COUNTER_COLLECTION=updatecounters
DELIVERY_CONSUMER_UPDATE_LOG_COLLECTION=updatelogs
DELIVERY_CONSUMER_OUTBOX_COLLECTION=chatdeliveryoutboxes
DELIVERY_CONSUMER_WAKE_PUBSUB_CHANNEL=sync:update:wake:v1
```

Phase 9 rollback is still one env flip: set `DELIVERY_EXECUTION_MODE=rollback_node` on the backend and return `DELIVERY_CONSUMER_EXECUTION_MODE=canary` or `shadow` on the Go consumer. If `DELIVERY_GO_PRIMARY_READY=false`, the Go consumer hard-skips primary side effects even when `DELIVERY_CONSUMER_EXECUTION_MODE=primary`.

Phase 11 finishes the private-chat takeover. Keep group fanout on Node, but switch all private chats to Go primary by moving the backend to `go_primary`, the consumer to `primary`, and the private rollout percentage to `100`. Node no longer owns the happy path for private chats; it only exists as the fallback executor for stale or failed `go_primary` outboxes.

Recommended Phase 11 private-primary values:

```bash
DELIVERY_EXECUTION_MODE=go_primary
DELIVERY_GO_PRIMARY_READY=true
DELIVERY_GO_PRIMARY_PRIVATE_ENABLED=true
DELIVERY_GO_PRIMARY_GROUP_ENABLED=false
DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT=100
DELIVERY_GO_PRIMARY_GROUP_ROLLOUT_PERCENT=0
DELIVERY_GO_PRIMARY_MAX_RECIPIENTS=2
DELIVERY_CONSUMER_EXECUTION_MODE=primary
```

When `/api/ops/chat-delivery` reports fallback candidates, replay only the `go_primary` backlog through the dedicated fallback endpoint:

```bash
curl -X POST \
  -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" \
  -H "Content-Type: application/json" \
  https://api.example.com/api/ops/chat-delivery/fallback/replay \
  -d '{"limit":10,"staleAfterMinutes":15}'
```

That endpoint re-queues only stale or failed `go_primary` outboxes onto the legacy BullMQ worker and records the recovery as `legacy_replay`, so operators can keep Go as the default private execution lane while Node remains fallback-only.

Phase 12 adds explicit `group_canary` rollout on top of the private-primary baseline. Selected small groups are written as `go_group_canary` outboxes and executed by the Go consumer, while all non-selected groups stay on the Node/BullMQ path. Use group allowlists plus a lower `DELIVERY_GO_PRIMARY_GROUP_MAX_RECIPIENTS` ceiling to keep the canary scoped to small rooms first.

Recommended Phase 12 group-canary values:

```bash
DELIVERY_EXECUTION_MODE=go_primary
DELIVERY_GO_PRIMARY_READY=true
DELIVERY_GO_PRIMARY_PRIVATE_ENABLED=true
DELIVERY_GO_PRIMARY_GROUP_ENABLED=true
DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT=100
DELIVERY_GO_PRIMARY_GROUP_ROLLOUT_PERCENT=10
DELIVERY_GO_PRIMARY_MAX_RECIPIENTS=2
DELIVERY_GO_PRIMARY_GROUP_MAX_RECIPIENTS=32
DELIVERY_GO_PRIMARY_GROUP_ALLOW_CHAT_IDS=group-canary-1,group-canary-2
DELIVERY_CONSUMER_EXECUTION_MODE=primary
DELIVERY_CONSUMER_PRIMARY_MAX_RECIPIENTS=2
DELIVERY_CONSUMER_PRIMARY_GROUP_MAX_RECIPIENTS=32
DELIVERY_CONSUMER_PRIMARY_GROUP_ROLLOUT_PERCENT=10
```

Operators can inspect only group fallback backlog by querying the fallback endpoint with `chatType=group`:

```bash
curl \
  -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" \
  "https://api.example.com/api/ops/chat-delivery/fallback?chatType=group"
```

If group canary drifts, replay just the group backlog back into the legacy queue:

```bash
curl -X POST \
  -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" \
  -H "Content-Type: application/json" \
  https://api.example.com/api/ops/chat-delivery/fallback/replay \
  -d '{"limit":10,"staleAfterMinutes":15,"chatType":"group"}'
```

Phase 13 finishes the group takeover and moves the delivery stack into explicit `full_primary`. Both private chats and eligible groups are now published as Go-owned outboxes, while Node remains on the box only for fallback/replay endpoints and rollback safety. In ops terms, `takeoverStage=full_primary`, `segmentStages.private=go_primary`, `segmentStages.group=go_primary`, and `fallbackStrategy=fallback_only`.

Recommended Phase 13 full-primary values:

```bash
DELIVERY_EXECUTION_MODE=go_primary
DELIVERY_GO_PRIMARY_READY=true
DELIVERY_GO_PRIMARY_PRIVATE_ENABLED=true
DELIVERY_GO_PRIMARY_GROUP_ENABLED=true
DELIVERY_GO_PRIMARY_PRIVATE_ROLLOUT_PERCENT=100
DELIVERY_GO_PRIMARY_GROUP_ROLLOUT_PERCENT=100
DELIVERY_GO_PRIMARY_MAX_RECIPIENTS=2
DELIVERY_GO_PRIMARY_GROUP_MAX_RECIPIENTS=32
DELIVERY_GO_PRIMARY_ALLOW_CHAT_IDS=
DELIVERY_GO_PRIMARY_ALLOW_SENDER_IDS=
DELIVERY_GO_PRIMARY_GROUP_ALLOW_CHAT_IDS=
DELIVERY_GO_PRIMARY_GROUP_ALLOW_SENDER_IDS=

DELIVERY_CONSUMER_EXECUTION_MODE=primary
DELIVERY_CONSUMER_PRIMARY_PRIVATE_ROLLOUT_PERCENT=100
DELIVERY_CONSUMER_PRIMARY_GROUP_ROLLOUT_PERCENT=100
DELIVERY_CONSUMER_PRIMARY_MAX_RECIPIENTS=2
DELIVERY_CONSUMER_PRIMARY_GROUP_MAX_RECIPIENTS=32
```

Use `/api/ops/chat-delivery` as the authoritative rollout decision surface before and after every release. A healthy Phase 13 snapshot should show:

- `rollout.takeoverStage = full_primary`
- `rollout.segmentStages.private = go_primary`
- `rollout.segmentStages.group = go_primary`
- `rollout.fallbackStrategy = fallback_only`
- `consumer.runtime.executionMode = primary`
- `consumer.runtime.takeoverStage = full_primary`
- `consumer.runtime.segmentStages.private = go_primary`
- `consumer.runtime.segmentStages.group = go_primary`

If full-primary drift appears, keep Go as the default lane and recover only the stale backlog through the fallback replay endpoint. Roll back to Node only when the rollout assessment reports `rollback_to_node` or when group projections show failures without any successful full-primary completions.

Internal Go consumer endpoints stay bound to localhost on the VPS:

- `GET http://127.0.0.1:4100/health`
- `GET http://127.0.0.1:4100/ops/summary`

The backend `/api/ops/chat-delivery` response now includes `eventBus.consumerGroups`, rollout policy, the internal consumer summary, and the canary stream summary, so you can confirm that the Go consumer group is attached and whether comparison, DLQ, or canary result counters are drifting without exposing the consumer publicly.

To replay failed or stalled delivery chunks:

```bash
curl -X POST \
  -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" \
  -H "Content-Type: application/json" \
  https://api.example.com/api/ops/chat-delivery/replay \
  -d '{"limit":10,"staleAfterMinutes":15}'
```

## Nginx

Render `nginx.telegram.conf.example` with a real domain, copy it to `/etc/nginx/sites-available/telegram.conf`, then enable it. `/socket.io/` keeps proxying to the Node backend in compat mode; all other traffic enters the Rust gateway:

```bash
export API_DOMAIN=api.example.com
envsubst '${API_DOMAIN}' < deploy/vps/nginx.telegram.conf.example | sudo tee /etc/nginx/sites-available/telegram.conf >/dev/null
sudo ln -s /etc/nginx/sites-available/telegram.conf /etc/nginx/sites-enabled/telegram.conf
sudo nginx -t
sudo systemctl reload nginx
```

## TLS

Once `${API_DOMAIN}` resolves to the VPS IP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "${API_DOMAIN}" --redirect
```

## Repeatable Firebase release

```bash
cp deploy/firebase/frontend.env.production.example deploy/firebase/frontend.env.production
# edit deploy/firebase/frontend.env.production with the real API domain
# adjust VITE_CHAT_ROLLOUT_STORAGE_* and VITE_CHAT_STORAGE_SHADOW_* when staging sqlite-opfs rollout
deploy/firebase/release_frontend.sh
```
