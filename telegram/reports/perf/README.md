# Performance Report Template

This directory stores generated Phase 3 performance gate reports.

## Required Run Metadata

- commit: git commit under test.
- generated_at_utc: UTC report timestamp.
- report_dir: generated report directory.
- baseline_json: baseline benchmark JSON path when regression gating is enabled.
- optimized_json: optimized benchmark JSON path, or `generated-by-gate`.
- regression_threshold_pct: default `5`.
- cpp_bench_runs: number of local `graph-store-bench --json` samples aggregated when the gate generates optimized JSON.
- run_infra_load: whether optional Redis/Mongo/WebSocket/HTTP infrastructure load fixtures were executed.
- run_checks: whether the gate executed service checks and C++ bench locally.

## Required Configuration And Scale Fields

Every service section should record:

- command: exact command used to produce the metrics.
- data scale: request count, batch size, queue depth, and service-specific dataset size.
- key latency metrics: p50, p95, p99.
- reliability fields: timeouts, fallback, budget exhausted.
- cache fields: cache hit and cache miss.

## Cross-Service Validation Contract

| service | status | source | gate behavior |
| --- | --- | --- | --- |
| Go delivery | implemented local + infra fixtures | `go run ./cmd/perf-fixture`; `PERF_RUN_INFRA_LOAD=true node scripts/perf/infra_load_fixture.mjs` | fail when keyed dispatch/batch ACK fixture p95 or p99 regresses by more than 5%; optional infra gate covers Redis Stream lag/PEL, batch ACK, wake publish, and Mongo reservation/outbox bulk |
| Rust gateway | implemented local + infra fixtures | `cargo run -- --perf-fixture`; `PERF_RUN_INFRA_LOAD=true node scripts/perf/infra_load_fixture.mjs` | fail when session registry target resolve fixture p95 or p99 regresses by more than 5%; optional infra gate covers Redis fanout stream and WebSocket connect |
| Rust recommendation | implemented local + infra fixtures | `cargo run -p telegram-rust-recommendation -- --perf-fixture`; `PERF_RUN_INFRA_LOAD=true node scripts/perf/infra_load_fixture.mjs` | fail when local cache/singleflight fixture p95 or p99 regresses by more than 5%; optional infra gate covers configured recommendation HTTP hit/miss path |
| C++ graph | implemented | `graph-store-bench --json` | fail when any matched bench p95 or p99 regresses by more than 5% |

## Baseline Discipline

The checked-in C++ baseline should be refreshed from a clean pre-change or release commit on the same machine class, compiler, build type, and synthetic dataset used for the optimized run. Microsecond-level C++ p95/p99 paths are sensitive to local scheduling noise; when the gate generates optimized JSON itself, it runs multiple samples and keeps the best p95/p99 sample per bench path. Existing JSON-to-JSON comparisons remain single-file comparisons so CI can use externally produced artifacts.

## Generated Files

- `report.md`: human-readable command table, key metrics, and regression conclusion.
- `summary.json`: machine-readable metadata, command status, metrics, and regression status.
- `go-delivery-perf.json`: Go delivery keyed dispatch/batch ACK local hot-path fixture.
- `rust-gateway-perf.json`: Rust gateway session registry local hot-path fixture.
- `rust-recommendation-perf.json`: Rust recommendation cache/singleflight local hot-path fixture.
- `infra-load.json`: optional Redis/Mongo/WebSocket/HTTP/C++ snapshot infrastructure fixture output. It is generated as `skipped` unless `PERF_RUN_INFRA_LOAD=true`.
- `infra-load-metrics.json`: normalized optional infrastructure metric rows.
- `go-delivery-regression.json` / `.md`: Go delivery local fixture baseline comparison.
- `rust-gateway-regression.json` / `.md`: Rust gateway local fixture baseline comparison.
- `rust-recommendation-regression.json` / `.md`: Rust recommendation local fixture baseline comparison.
- `cpp-graph-bench.json`: optimized/current C++ graph benchmark JSON.
- `cpp-graph-metrics.json`: normalized C++ graph metric rows.
- `cpp-graph-regression.json`: C++ graph baseline comparison result when `PERF_BASELINE_JSON` is provided.
- `cpp-graph-regression.md`: markdown table for the C++ graph regression result.

## Example Usage

Run full local gate and compare against a baseline:

```bash
scripts/perf/run_performance_gate.sh \
  --baseline-json telegram-cpp-graph-service/benchmarks/graph_store_baseline.json \
  --cpp-bench-runs 5
```

Compare two existing C++ graph bench JSON files without running service checks:

```bash
scripts/perf/run_performance_gate.sh \
  --skip-checks \
  --baseline-json reports/perf/baseline/cpp-graph-bench.json \
  --optimized-json reports/perf/current/cpp-graph-bench.json
```

Run the optional infrastructure load gate only when Redis/Mongo/WebSocket/HTTP targets are explicitly configured:

```bash
PERF_RUN_INFRA_LOAD=true \
PERF_INFRA_REDIS_URL=redis://127.0.0.1:6379/0 \
PERF_INFRA_MONGO_URI=mongodb://127.0.0.1:27017/telegram_perf \
PERF_GATEWAY_WS_URL=ws://127.0.0.1:8080/ws \
PERF_RECOMMENDATION_URL=http://127.0.0.1:8081 \
scripts/perf/run_performance_gate.sh \
  --baseline-json telegram-cpp-graph-service/benchmarks/graph_store_baseline.json
```
