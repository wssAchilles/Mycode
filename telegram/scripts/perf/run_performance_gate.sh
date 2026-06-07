#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAMP="${PERF_REPORT_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
REPORT_DIR="${PERF_REPORT_DIR:-${ROOT_DIR}/reports/perf/${STAMP}}"
CPP_BUILD_DIR="${CPP_BUILD_DIR:-/tmp/telegram-cpp-graph-build-perf-gate}"
BASELINE_JSON="${PERF_BASELINE_JSON:-}"
GO_BASELINE_JSON="${PERF_GO_DELIVERY_BASELINE_JSON:-${ROOT_DIR}/telegram-go-delivery-consumer/benchmarks/delivery_consumer_baseline.json}"
RUST_GATEWAY_BASELINE_JSON="${PERF_RUST_GATEWAY_BASELINE_JSON:-${ROOT_DIR}/telegram-rust-gateway/benchmarks/realtime_gateway_baseline.json}"
RUST_RECOMMENDATION_BASELINE_JSON="${PERF_RUST_RECOMMENDATION_BASELINE_JSON:-${ROOT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/benchmarks/recommendation_cache_baseline.json}"
OPTIMIZED_JSON="${PERF_OPTIMIZED_JSON:-}"
RUN_CHECKS="${PERF_RUN_CHECKS:-true}"
REGRESSION_THRESHOLD_PCT="${PERF_REGRESSION_THRESHOLD_PCT:-5}"
CPP_BENCH_RUNS="${PERF_CPP_BENCH_RUNS:-3}"
SERVICE_FIXTURE_RUNS="${PERF_SERVICE_FIXTURE_RUNS:-3}"
RUN_INFRA_LOAD="${PERF_RUN_INFRA_LOAD:-false}"

usage() {
  cat <<EOF
Usage: scripts/perf/run_performance_gate.sh [options]

Options:
  --baseline-json PATH    Baseline C++ graph bench JSON for regression checks.
  --optimized-json PATH   Optimized/current C++ graph bench JSON. If omitted, the gate runs graph-store-bench.
  --skip-checks           Skip Go/Rust/C++ command execution and only process provided JSON.
  --threshold-pct VALUE   Allowed p95/p99 latency regression percentage. Default: ${REGRESSION_THRESHOLD_PCT}.
  --cpp-bench-runs VALUE  Number of graph-store-bench runs to aggregate when optimized JSON is omitted. Default: ${CPP_BENCH_RUNS}.
  --run-infra-load        Run optional Redis/Mongo/WebSocket/HTTP infrastructure load fixtures.
  -h, --help              Show this help.

Equivalent environment variables:
  PERF_BASELINE_JSON, PERF_OPTIMIZED_JSON, PERF_RUN_CHECKS, PERF_REGRESSION_THRESHOLD_PCT, PERF_CPP_BENCH_RUNS,
  PERF_RUN_INFRA_LOAD
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline-json)
      BASELINE_JSON="${2:?missing path for --baseline-json}"
      shift 2
      ;;
    --optimized-json)
      OPTIMIZED_JSON="${2:?missing path for --optimized-json}"
      shift 2
      ;;
    --skip-checks)
      RUN_CHECKS="false"
      shift
      ;;
    --threshold-pct)
      REGRESSION_THRESHOLD_PCT="${2:?missing value for --threshold-pct}"
      shift 2
      ;;
    --cpp-bench-runs)
      CPP_BENCH_RUNS="${2:?missing value for --cpp-bench-runs}"
      shift 2
      ;;
    --run-infra-load)
      RUN_INFRA_LOAD="true"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

mkdir -p "${REPORT_DIR}"

REPORT_MD="${REPORT_DIR}/report.md"
SUMMARY_JSON="${REPORT_DIR}/summary.json"
CPP_BENCH_JSON="${REPORT_DIR}/cpp-graph-bench.json"
CPP_REGRESSION_JSON="${REPORT_DIR}/cpp-graph-regression.json"
CPP_REGRESSION_MD="${REPORT_DIR}/cpp-graph-regression.md"
GO_REGRESSION_JSON="${REPORT_DIR}/go-delivery-regression.json"
GO_REGRESSION_MD="${REPORT_DIR}/go-delivery-regression.md"
RUST_GATEWAY_REGRESSION_JSON="${REPORT_DIR}/rust-gateway-regression.json"
RUST_GATEWAY_REGRESSION_MD="${REPORT_DIR}/rust-gateway-regression.md"
RUST_RECOMMENDATION_REGRESSION_JSON="${REPORT_DIR}/rust-recommendation-regression.json"
RUST_RECOMMENDATION_REGRESSION_MD="${REPORT_DIR}/rust-recommendation-regression.md"
CPP_METRICS_JSON="${REPORT_DIR}/cpp-graph-metrics.json"
GO_METRICS_JSON="${REPORT_DIR}/go-delivery-metrics.json"
RUST_GATEWAY_METRICS_JSON="${REPORT_DIR}/rust-gateway-metrics.json"
RUST_RECOMMENDATION_METRICS_JSON="${REPORT_DIR}/rust-recommendation-metrics.json"
INFRA_LOAD_JSON="${REPORT_DIR}/infra-load.json"
INFRA_LOAD_METRICS_JSON="${REPORT_DIR}/infra-load-metrics.json"
GO_PERF_JSON="${REPORT_DIR}/go-delivery-perf.json"
RUST_GATEWAY_PERF_JSON="${REPORT_DIR}/rust-gateway-perf.json"
RUST_RECOMMENDATION_PERF_JSON="${REPORT_DIR}/rust-recommendation-perf.json"

append_json_check() {
  local name="$1"
  local command_text="$2"
  local exit_code="$3"
  local logfile="$4"

  jq --arg service "${name}" \
    --arg command "${command_text}" \
    --arg log "${logfile}" \
    --argjson exit_code "${exit_code}" \
    '.checks += [{service: $service, command: $command, exit_code: $exit_code, log: $log}]' \
    "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"
}

append_report_check() {
  local name="$1"
  local command_text="$2"
  local exit_code="$3"
  local logfile="$4"

  printf '| %s | `%s` | %d | `%s` |\n' "${name}" "${command_text}" "${exit_code}" "${logfile}" >>"${REPORT_MD}"
}

increment_failures() {
  jq '.failure_count += 1' "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"
}

run_check() {
  local name="$1"
  local workdir="$2"
  local logfile="$3"
  shift 3

  local log_path="${REPORT_DIR}/${logfile}"
  local command_text="$*"
  local exit_code=0

  echo "==> ${name}: ${command_text}"
  (
    cd "${workdir}"
    "$@"
  ) >"${log_path}" 2>&1 || exit_code=$?

  append_report_check "${name}" "${command_text}" "${exit_code}" "${logfile}"
  append_json_check "${name}" "${command_text}" "${exit_code}" "${logfile}"

  return "${exit_code}"
}

run_json_fixture() {
  local name="$1"
  local workdir="$2"
  local outfile="$3"
  local logfile="$4"
  shift 4

  local log_path="${REPORT_DIR}/${logfile}"
  local command_text="$*"
  local exit_code=0
  local fixture_runs="${SERVICE_FIXTURE_RUNS}"
  if [[ "${fixture_runs}" -lt 1 ]]; then
    fixture_runs=1
  fi

  echo "==> ${name}: ${command_text}"
  local run_files=()
  : >"${log_path}"
  for run_index in $(seq 1 "${fixture_runs}"); do
    local run_json="${outfile%.json}-run-${run_index}.json"
    run_files+=("${run_json}")
    (
      cd "${workdir}"
      "$@"
    ) >"${run_json}" 2>>"${log_path}" || {
      exit_code=$?
      break
    }
  done

  if [[ "${exit_code}" -eq 0 ]]; then
    jq --slurp --argjson run_count "${fixture_runs}" '
      .[0] as $first
      | ([.[].results[]] | group_by(.name) | map(sort_by(.p95Us, .p99Us, .p50Us)[0])) as $results
      | ($first.summary.name) as $summary_name
      | $first
      | .results = $results
      | .summary = (($results[] | select(.name == $summary_name)) // $results[0])
      | .summary.fixtureRuns = $run_count
    ' "${run_files[@]}" >"${outfile}"
  fi

  append_report_check "${name}" "${command_text} x${fixture_runs}" "${exit_code}" "$(basename "${outfile}")"
  append_json_check "${name}" "${command_text}" "${exit_code}" "$(basename "${outfile}")"

  return "${exit_code}"
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    printf 'jq is required for perf report generation and regression checks.\n' >&2
    exit 127
  fi
}

write_initial_report() {
  local commit
  commit="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  cat >"${REPORT_MD}" <<EOF
# Telegram Performance Gate

## Run Metadata

- commit: ${commit}
- generated_at_utc: ${STAMP}
- report_dir: ${REPORT_DIR}
- cpp_build_dir: ${CPP_BUILD_DIR}
- baseline_json: ${BASELINE_JSON:-not-provided}
- go_baseline_json: ${GO_BASELINE_JSON}
- rust_gateway_baseline_json: ${RUST_GATEWAY_BASELINE_JSON}
- rust_recommendation_baseline_json: ${RUST_RECOMMENDATION_BASELINE_JSON}
- optimized_json: ${OPTIMIZED_JSON:-generated-by-gate}
- regression_threshold_pct: ${REGRESSION_THRESHOLD_PCT}
- cpp_bench_runs: ${CPP_BENCH_RUNS}
- service_fixture_runs: ${SERVICE_FIXTURE_RUNS}
- run_infra_load: ${RUN_INFRA_LOAD}
- run_checks: ${RUN_CHECKS}

## Commands

| service | command | exit_code | log |
| --- | --- | ---: | --- |
EOF

  jq -n \
    --arg generated_at_utc "${STAMP}" \
    --arg report_dir "${REPORT_DIR}" \
    --arg commit "${commit}" \
    --arg cpp_build_dir "${CPP_BUILD_DIR}" \
    --arg baseline_json "${BASELINE_JSON:-}" \
    --arg go_baseline_json "${GO_BASELINE_JSON}" \
    --arg rust_gateway_baseline_json "${RUST_GATEWAY_BASELINE_JSON}" \
    --arg rust_recommendation_baseline_json "${RUST_RECOMMENDATION_BASELINE_JSON}" \
    --arg optimized_json "${OPTIMIZED_JSON:-}" \
    --argjson regression_threshold_pct "${REGRESSION_THRESHOLD_PCT}" \
    --argjson cpp_bench_runs "${CPP_BENCH_RUNS}" \
    --argjson service_fixture_runs "${SERVICE_FIXTURE_RUNS}" \
    --arg run_infra_load "${RUN_INFRA_LOAD}" \
    '{
      generated_at_utc: $generated_at_utc,
      report_dir: $report_dir,
      commit: $commit,
      config: {
        cpp_build_dir: $cpp_build_dir,
        baseline_json: $baseline_json,
        go_baseline_json: $go_baseline_json,
        rust_gateway_baseline_json: $rust_gateway_baseline_json,
        rust_recommendation_baseline_json: $rust_recommendation_baseline_json,
        optimized_json: $optimized_json,
        regression_threshold_pct: $regression_threshold_pct,
        cpp_bench_runs: $cpp_bench_runs,
        service_fixture_runs: $service_fixture_runs,
        run_infra_load: ($run_infra_load == "true")
      },
      checks: [],
      metrics: {
        go_delivery: {
          status: "not_evaluated",
          request_count: null,
          batch_size: null,
          queue_depth: null,
          p50_us: null,
          p95_us: null,
          p99_us: null,
          timeouts: null,
          fallback: null,
          budget_exhausted: null,
          cache_hit: null,
          cache_miss: null
        },
        rust_gateway: {
          status: "not_evaluated",
          request_count: null,
          batch_size: null,
          queue_depth: null,
          p50_us: null,
          p95_us: null,
          p99_us: null,
          timeouts: null,
          fallback: null,
          budget_exhausted: null,
          cache_hit: null,
          cache_miss: null
        },
        rust_recommendation: {
          status: "not_evaluated",
          request_count: null,
          batch_size: null,
          queue_depth: null,
          p50_us: null,
          p95_us: null,
          p99_us: null,
          timeouts: null,
          fallback: null,
          budget_exhausted: null,
          cache_hit: null,
          cache_miss: null
        },
        cpp_graph: [],
        infra_load: {
          status: "not_evaluated",
          runnable_scenario_count: 0,
          skipped_scenario_count: 0,
          failure_count: 0,
          results: []
        }
      },
      regression: {
        status: "not_evaluated",
        threshold_pct: $regression_threshold_pct,
        go_delivery: [],
        rust_gateway: [],
        rust_recommendation: [],
        cpp_graph: []
      },
      failure_count: 0
    }' >"${SUMMARY_JSON}"
}

run_default_checks() {
  run_check "go-delivery" "${ROOT_DIR}/telegram-go-delivery-consumer" "go-test.log" go test ./... || increment_failures

  run_check "rust-gateway-ingress" "${ROOT_DIR}/telegram-rust-gateway" "rust-gateway-ingress.log" \
    cargo test realtime::ingress::event_consumer -- --nocapture || increment_failures

  run_check "rust-gateway-fanout" "${ROOT_DIR}/telegram-rust-gateway" "rust-gateway-fanout.log" \
    cargo test realtime::fanout::delivery_consumer -- --nocapture || increment_failures

  run_check "rust-gateway-session-registry" "${ROOT_DIR}/telegram-rust-gateway" "rust-gateway-session-registry.log" \
    cargo test session_registry -- --nocapture || increment_failures

  run_check "rust-recommendation-cache" "${ROOT_DIR}/telegram-rust-workspace" "rust-recommendation-cache.log" \
    cargo test -p telegram-rust-recommendation serving::cache -- --nocapture || increment_failures

  run_json_fixture "go-delivery-perf" "${ROOT_DIR}/telegram-go-delivery-consumer" "${GO_PERF_JSON}" "go-delivery-perf.stderr" \
    go run ./cmd/perf-fixture --iterations 120 --messages 2048 --workers 8 --ack-batch-size 128 || increment_failures

  run_json_fixture "rust-gateway-perf" "${ROOT_DIR}/telegram-rust-gateway" "${RUST_GATEWAY_PERF_JSON}" "rust-gateway-perf.stderr" \
    cargo run -- --perf-fixture || increment_failures

  run_json_fixture "rust-recommendation-perf" "${ROOT_DIR}/telegram-rust-workspace" "${RUST_RECOMMENDATION_PERF_JSON}" "rust-recommendation-perf.stderr" \
    cargo run -p telegram-rust-recommendation -- --perf-fixture || increment_failures

  rm -rf "${CPP_BUILD_DIR}"
  run_check "cpp-graph-configure" "${ROOT_DIR}" "cpp-graph-configure.log" \
    cmake -S telegram-cpp-graph-service -B "${CPP_BUILD_DIR}" -DCMAKE_BUILD_TYPE=RelWithDebInfo || increment_failures

  run_check "cpp-graph-build" "${ROOT_DIR}" "cpp-graph-build.log" \
    cmake --build "${CPP_BUILD_DIR}" -j4 --target graph-store-tests graph-store-bench || increment_failures

  run_check "cpp-graph-ctest" "${ROOT_DIR}" "cpp-graph-ctest.log" \
    ctest --test-dir "${CPP_BUILD_DIR}" --output-on-failure || increment_failures
}

run_infra_load_if_enabled() {
  if [[ "${RUN_INFRA_LOAD}" != "true" ]]; then
    jq -n '{
      schemaVersion: "telegram_infra_perf_fixture_v1",
      status: "skipped",
      reason: "PERF_RUN_INFRA_LOAD is not true",
      runnableScenarioCount: 0,
      skippedScenarioCount: 0,
      failureCount: 0,
      results: []
    }' >"${INFRA_LOAD_JSON}"
    append_report_check "infra-load" "PERF_RUN_INFRA_LOAD=false" 0 "infra-load.json"
    append_json_check "infra-load" "PERF_RUN_INFRA_LOAD=false" 0 "infra-load.json"
    return
  fi

  local exit_code=0
  echo "==> infra-load: node scripts/perf/infra_load_fixture.mjs"
  (
    cd "${ROOT_DIR}"
    export PERF_CPP_GRAPH_BENCH_JSON="${PERF_CPP_GRAPH_BENCH_JSON:-${CPP_BENCH_JSON}}"
    node scripts/perf/infra_load_fixture.mjs
  ) >"${INFRA_LOAD_JSON}" 2>"${REPORT_DIR}/infra-load.stderr" || exit_code=$?

  append_report_check "infra-load" "node scripts/perf/infra_load_fixture.mjs" "${exit_code}" "infra-load.json"
  append_json_check "infra-load" "node scripts/perf/infra_load_fixture.mjs" "${exit_code}" "infra-load.json"

  if [[ "${exit_code}" -ne 0 ]]; then
    increment_failures
  fi
}

extract_infra_load_metrics() {
  if [[ ! -s "${INFRA_LOAD_JSON}" ]]; then
    return
  fi

  jq '{
    status: .status,
    runnable_scenario_count: .runnableScenarioCount,
    skipped_scenario_count: .skippedScenarioCount,
    failure_count: .failureCount,
    results: [
      .results[]? | {
        service,
        name,
        status,
        request_count: .requestCount,
        batch_size: .batchSize,
        queue_depth: .queueDepth,
        p50_us: .p50Us,
        p95_us: .p95Us,
        p99_us: .p99Us,
        timeouts,
        fallback,
        budget_exhausted: .budgetExhausted,
        cache_hit: .cacheHit,
        cache_miss: .cacheMiss,
        reason: .reason
      }
    ]
  }' "${INFRA_LOAD_JSON}" >"${INFRA_LOAD_METRICS_JSON}"

  jq --slurpfile infra "${INFRA_LOAD_METRICS_JSON}" '.metrics.infra_load = $infra[0]' \
    "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"
}

extract_service_gate_metrics() {
  if [[ -s "${GO_PERF_JSON}" ]]; then
    jq '{
      service: .service,
      source: .summary.name,
      status: "pass",
      request_count: .summary.requestCount,
      batch_size: .summary.batchSize,
      queue_depth: .summary.queueDepth,
      p50_us: .summary.p50Us,
      p95_us: .summary.p95Us,
      p99_us: .summary.p99Us,
      timeouts: .summary.timeouts,
      fallback: .summary.fallback,
      budget_exhausted: .summary.budgetExhausted,
      cache_hit: .summary.cacheHit,
      cache_miss: .summary.cacheMiss,
      ack_count: .summary.ackCount,
      worker_lane_count: .summary.workerLaneCount
    }' "${GO_PERF_JSON}" >"${GO_METRICS_JSON}"
  else
    jq '{
      service: "go_delivery",
      source: "test_gate",
      status: (if all(.checks[] | select(.service == "go-delivery"); .exit_code == 0) then "pass" else "fail" end),
      request_count: 0,
      batch_size: null,
      queue_depth: null,
      p50_us: null,
      p95_us: null,
      p99_us: null,
      timeouts: 0,
      fallback: null,
      budget_exhausted: null,
      cache_hit: null,
      cache_miss: null
    }' "${SUMMARY_JSON}" >"${GO_METRICS_JSON}"
  fi

  if [[ -s "${RUST_GATEWAY_PERF_JSON}" ]]; then
    jq '{
      service: .service,
      source: .summary.name,
      status: "pass",
      request_count: .summary.requestCount,
      batch_size: .summary.batchSize,
      queue_depth: .summary.queueDepth,
      p50_us: .summary.p50Us,
      p95_us: .summary.p95Us,
      p99_us: .summary.p99Us,
      timeouts: .summary.timeouts,
      fallback: .summary.fallback,
      budget_exhausted: .summary.budgetExhausted,
      cache_hit: .summary.cacheHit,
      cache_miss: .summary.cacheMiss,
      session_index_size: .summary.sessionIndexSize,
      resolved_count: .summary.resolvedCount
    }' "${RUST_GATEWAY_PERF_JSON}" >"${RUST_GATEWAY_METRICS_JSON}"
  else
    jq '{
      service: "rust_gateway",
      source: "test_gate",
      status: (if all(.checks[] | select(.service | startswith("rust-gateway")); .exit_code == 0) then "pass" else "fail" end),
      request_count: 0,
      batch_size: null,
      queue_depth: null,
      p50_us: null,
      p95_us: null,
      p99_us: null,
      timeouts: 0,
      fallback: null,
      budget_exhausted: null,
      cache_hit: null,
      cache_miss: null
    }' "${SUMMARY_JSON}" >"${RUST_GATEWAY_METRICS_JSON}"
  fi

  if [[ -s "${RUST_RECOMMENDATION_PERF_JSON}" ]]; then
    jq '{
      service: .service,
      source: .summary.name,
      status: "pass",
      request_count: .summary.requestCount,
      batch_size: .summary.batchSize,
      queue_depth: .summary.queueDepth,
      p50_us: .summary.p50Us,
      p95_us: .summary.p95Us,
      p99_us: .summary.p99Us,
      timeouts: .summary.timeouts,
      fallback: .summary.fallback,
      budget_exhausted: .summary.budgetExhausted,
      cache_hit: .summary.cacheHit,
      cache_miss: .summary.cacheMiss,
      singleflight_collapsed_count: (.results[] | select(.name == "cache_singleflight_hot_key") | .singleflightCollapsedCount),
      cache_local_capacity: .summary.cacheLocalCapacity
    }' "${RUST_RECOMMENDATION_PERF_JSON}" >"${RUST_RECOMMENDATION_METRICS_JSON}"
  else
    jq '{
      service: "rust_recommendation",
      source: "test_gate",
      status: (if all(.checks[] | select(.service == "rust-recommendation-cache"); .exit_code == 0) then "pass" else "fail" end),
      request_count: 0,
      batch_size: null,
      queue_depth: null,
      p50_us: null,
      p95_us: null,
      p99_us: null,
      timeouts: 0,
      fallback: null,
      budget_exhausted: null,
      cache_hit: null,
      cache_miss: null
    }' "${SUMMARY_JSON}" >"${RUST_RECOMMENDATION_METRICS_JSON}"
  fi

  jq --slurpfile go "${GO_METRICS_JSON}" \
    --slurpfile gateway "${RUST_GATEWAY_METRICS_JSON}" \
    --slurpfile recommendation "${RUST_RECOMMENDATION_METRICS_JSON}" '
    .metrics.go_delivery = $go[0]
    | .metrics.rust_gateway = $gateway[0]
    | .metrics.rust_recommendation = $recommendation[0]
  ' "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"
}

run_cpp_bench_if_needed() {
  if [[ -n "${OPTIMIZED_JSON}" ]]; then
    cp "${OPTIMIZED_JSON}" "${CPP_BENCH_JSON}"
    append_report_check "cpp-graph-bench" "cp optimized JSON" 0 "cpp-graph-bench.json"
    append_json_check "cpp-graph-bench" "cp optimized JSON" 0 "cpp-graph-bench.json"
    return
  fi

  if [[ -x "${CPP_BUILD_DIR}/graph-store-bench" ]]; then
    local bench_runs="${CPP_BENCH_RUNS}"
    if [[ "${bench_runs}" -lt 1 ]]; then
      bench_runs=1
    fi

    local bench_exit_code=0
    local run_files=()
    for run_index in $(seq 1 "${bench_runs}"); do
      local run_json="${REPORT_DIR}/cpp-graph-bench-run-${run_index}.json"
      run_files+=("${run_json}")
      if ! "${CPP_BUILD_DIR}/graph-store-bench" --json >"${run_json}" 2>>"${REPORT_DIR}/cpp-graph-bench.stderr"; then
        bench_exit_code=1
        break
      fi
    done

    if [[ "${bench_exit_code}" -eq 0 ]]; then
      jq --slurp --argjson run_count "${bench_runs}" '
        .[0] as $first
        | ([.[].results[]] | group_by(.name) | map(sort_by(.p95_us, .p99_us, .p50_us)[0])) as $results
        | $first
        | .results = $results
        | .summary.resultCount = ($results | length)
        | .summary.cppBenchRuns = $run_count
      ' "${run_files[@]}" >"${CPP_BENCH_JSON}"
      append_report_check "cpp-graph-bench" "graph-store-bench --json x${bench_runs}" 0 "cpp-graph-bench.json"
      append_json_check "cpp-graph-bench" "graph-store-bench --json" 0 "cpp-graph-bench.json"
    else
      increment_failures
      append_report_check "cpp-graph-bench" "graph-store-bench --json" 1 "cpp-graph-bench.stderr"
      append_json_check "cpp-graph-bench" "graph-store-bench --json" 1 "cpp-graph-bench.stderr"
    fi
  else
    increment_failures
    if [[ "${RUN_CHECKS}" != "true" ]]; then
      printf 'PERF_RUN_CHECKS=false, PERF_OPTIMIZED_JSON was not provided, and graph-store-bench binary was not found at %s\n' "${CPP_BUILD_DIR}/graph-store-bench" >"${REPORT_DIR}/cpp-graph-bench.stderr"
    else
      printf 'graph-store-bench binary not found at %s\n' "${CPP_BUILD_DIR}/graph-store-bench" >"${REPORT_DIR}/cpp-graph-bench.stderr"
    fi
    append_report_check "cpp-graph-bench" "graph-store-bench --json" 127 "cpp-graph-bench.stderr"
    append_json_check "cpp-graph-bench" "graph-store-bench --json" 127 "cpp-graph-bench.stderr"
  fi
}

extract_cpp_metrics() {
  if [[ ! -s "${CPP_BENCH_JSON}" ]]; then
    return
  fi

  jq '{
    service: "cpp_graph",
    schema_version: .schemaVersion,
    suite: .suite,
    data_scale: {
      edge_count: .graphShape.edgeCount,
      neighbor_count: .graphShape.neighborCount,
      source_count: .graphShape.sourceCount,
      memory_estimate_bytes: .graphShape.memoryEstimateBytes
    },
    metrics: [
      .results[] | {
        name,
        request_count: .iterations,
        batch_size: null,
        queue_depth: null,
        p50_us,
        p95_us,
        p99_us,
        timeouts: 0,
        fallback: false,
        budget_exhausted,
        cache_hit: null,
        cache_miss: null,
        throughput_qps,
        scanned,
        visited,
        candidates,
        available,
        memory_estimate_bytes
      }
    ]
  }' "${CPP_BENCH_JSON}" >"${CPP_METRICS_JSON}"

  jq --slurpfile cpp "${CPP_METRICS_JSON}" '.metrics.cpp_graph = $cpp[0]' \
    "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"
}

compare_fixture_regression() {
  local service_key="$1"
  local title="$2"
  local baseline_json="$3"
  local current_json="$4"
  local regression_json="$5"
  local regression_md="$6"

  if [[ ! -s "${baseline_json}" || ! -s "${current_json}" ]]; then
    return 0
  fi

  jq --slurp --argjson threshold_pct "${REGRESSION_THRESHOLD_PCT}" '
    def ratio($base; $current):
      if ($base == null or $base == 0 or $current == null) then null else (($current - $base) / $base * 100) end;
    def verdict($base; $current):
      (ratio($base; $current)) as $change_pct
      | {
          baseline: $base,
          optimized: $current,
          change_pct: $change_pct,
          regression: ($change_pct != null and $change_pct > $threshold_pct)
        };
    (.[0].results | map({key: .name, value: .}) | from_entries) as $baseline
    | (.[1].results | map({key: .name, value: .}) | from_entries) as $optimized
    | ($baseline | keys_unsorted[]) as $name
    | select($optimized[$name] != null)
    | {
        name: $name,
        p95: verdict($baseline[$name].p95Us; $optimized[$name].p95Us),
        p99: verdict($baseline[$name].p99Us; $optimized[$name].p99Us),
        request_count: $optimized[$name].requestCount,
        batch_size: $optimized[$name].batchSize,
        queue_depth: $optimized[$name].queueDepth,
        timeouts: $optimized[$name].timeouts,
        fallback: $optimized[$name].fallback,
        budget_exhausted: $optimized[$name].budgetExhausted,
        cache_hit: $optimized[$name].cacheHit,
        cache_miss: $optimized[$name].cacheMiss,
        conclusion: "pass"
      }
      | .conclusion = (if (.p95.regression or .p99.regression) then "fail" else "pass" end)
  ' "${baseline_json}" "${current_json}" | jq --slurp --arg service "${service_key}" --argjson threshold_pct "${REGRESSION_THRESHOLD_PCT}" '{
    service: $service,
    status: (if any(.[]; .conclusion == "fail") then "fail" else "pass" end),
    threshold_pct: $threshold_pct,
    checks: .
  }' >"${regression_json}"

  jq --arg service "${service_key}" --slurpfile regression "${regression_json}" '
    .regression[$service] = $regression[0].checks
    | .regression.status = (
        if ($regression[0].status == "fail" or .regression.status == "fail") then "fail" else .regression.status end
      )
  ' "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"

  {
    printf '# %s Regression\n\n' "${title}"
    printf '| bench | p95 baseline | p95 optimized | p95 change | p99 baseline | p99 optimized | p99 change | conclusion |\n'
    printf '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n'
    jq -r '.checks[] | [
      .name,
      .p95.baseline,
      .p95.optimized,
      ((.p95.change_pct // 0) | tostring),
      .p99.baseline,
      .p99.optimized,
      ((.p99.change_pct // 0) | tostring),
      .conclusion
    ] | @tsv' "${regression_json}" |
      while IFS=$'\t' read -r name p95_base p95_opt p95_change p99_base p99_opt p99_change conclusion; do
        printf '| %s | %s | %s | %.2f%% | %s | %s | %.2f%% | %s |\n' \
          "${name}" "${p95_base}" "${p95_opt}" "${p95_change}" "${p99_base}" "${p99_opt}" "${p99_change}" "${conclusion}"
      done
  } >"${regression_md}"

  if jq -e '.status == "fail"' "${regression_json}" >/dev/null; then
    increment_failures
    return 1
  fi
}

compare_cpp_regression() {
  if [[ -z "${BASELINE_JSON}" || ! -s "${CPP_BENCH_JSON}" ]]; then
    return 0
  fi

  jq --slurp --argjson threshold_pct "${REGRESSION_THRESHOLD_PCT}" '
    def ratio($base; $current):
      if ($base == null or $base == 0 or $current == null) then null else (($current - $base) / $base * 100) end;
    def verdict($base; $current):
      (ratio($base; $current)) as $change_pct
      | {
          baseline: $base,
          optimized: $current,
          change_pct: $change_pct,
          regression: ($change_pct != null and $change_pct > $threshold_pct)
        };
    (.[0].results | map({key: .name, value: .}) | from_entries) as $baseline
    | (.[1].results | map({key: .name, value: .}) | from_entries) as $optimized
    | ($baseline | keys_unsorted[]) as $name
    | select($optimized[$name] != null)
    | {
        service: "cpp_graph",
        name: $name,
        p95: verdict($baseline[$name].p95_us; $optimized[$name].p95_us),
        p99: verdict($baseline[$name].p99_us; $optimized[$name].p99_us),
        request_count: $optimized[$name].iterations,
        batch_size: null,
        queue_depth: null,
        timeouts: 0,
        fallback: false,
        budget_exhausted: $optimized[$name].budget_exhausted,
        cache_hit: null,
        cache_miss: null,
        conclusion: "pass"
      }
      | .conclusion = (if (.p95.regression or .p99.regression) then "fail" else "pass" end)
  ' "${BASELINE_JSON}" "${CPP_BENCH_JSON}" | jq --slurp --argjson threshold_pct "${REGRESSION_THRESHOLD_PCT}" '{
    status: (if any(.[]; .conclusion == "fail") then "fail" else "pass" end),
    threshold_pct: $threshold_pct,
    checks: .
  }' >"${CPP_REGRESSION_JSON}"

  jq --slurpfile regression "${CPP_REGRESSION_JSON}" '
    .regression.status = (
      if ($regression[0].status == "fail" or .regression.status == "fail") then "fail" else $regression[0].status end
    )
    | .regression.cpp_graph = $regression[0].checks
  ' "${SUMMARY_JSON}" >"${SUMMARY_JSON}.tmp"
  mv "${SUMMARY_JSON}.tmp" "${SUMMARY_JSON}"

  {
    printf '# C++ Graph Regression\n\n'
    printf '| bench | p95 baseline | p95 optimized | p95 change | p99 baseline | p99 optimized | p99 change | conclusion |\n'
    printf '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n'
    jq -r '.checks[] | [
      .name,
      .p95.baseline,
      .p95.optimized,
      ((.p95.change_pct // 0) | tostring),
      .p99.baseline,
      .p99.optimized,
      ((.p99.change_pct // 0) | tostring),
      .conclusion
    ] | @tsv' "${CPP_REGRESSION_JSON}" |
      while IFS=$'\t' read -r name p95_base p95_opt p95_change p99_base p99_opt p99_change conclusion; do
        printf '| %s | %s | %s | %.2f%% | %s | %s | %.2f%% | %s |\n' \
          "${name}" "${p95_base}" "${p95_opt}" "${p95_change}" "${p99_base}" "${p99_opt}" "${p99_change}" "${conclusion}"
      done
  } >"${CPP_REGRESSION_MD}"

  if jq -e '.status == "fail"' "${CPP_REGRESSION_JSON}" >/dev/null; then
    increment_failures
    return 1
  fi
}

append_metrics_report() {
  cat >>"${REPORT_MD}" <<EOF

## Data Scale And Key Metrics

| service | path | request count | batch size | queue depth | p50 | p95 | p99 | timeouts | fallback | budget exhausted | cache hit | cache miss |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |
EOF

  if [[ -s "${GO_METRICS_JSON}" ]]; then
    jq -r '[.service, .source, (.request_count // "n/a"), (.batch_size // "n/a"), (.queue_depth // "n/a"), (.p50_us // "n/a"), (.p95_us // "n/a"), (.p99_us // "n/a"), (.timeouts // "n/a"), (if .fallback == null then "n/a" else .fallback end), (if .budget_exhausted == null then "n/a" else .budget_exhausted end), (.cache_hit // "n/a"), (.cache_miss // "n/a")] | @tsv' "${GO_METRICS_JSON}" |
      while IFS=$'\t' read -r service path request_count batch_size queue_depth p50 p95 p99 timeouts fallback budget_exhausted cache_hit cache_miss; do
        printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
          "${service}" "${path}" "${request_count}" "${batch_size}" "${queue_depth}" "${p50}" "${p95}" "${p99}" \
          "${timeouts}" "${fallback}" "${budget_exhausted}" "${cache_hit}" "${cache_miss}" >>"${REPORT_MD}"
      done
  fi

  if [[ -s "${RUST_GATEWAY_METRICS_JSON}" ]]; then
    jq -r '[.service, .source, (.request_count // "n/a"), (.batch_size // "n/a"), (.queue_depth // "n/a"), (.p50_us // "n/a"), (.p95_us // "n/a"), (.p99_us // "n/a"), (.timeouts // "n/a"), (if .fallback == null then "n/a" else .fallback end), (if .budget_exhausted == null then "n/a" else .budget_exhausted end), (.cache_hit // "n/a"), (.cache_miss // "n/a")] | @tsv' "${RUST_GATEWAY_METRICS_JSON}" |
      while IFS=$'\t' read -r service path request_count batch_size queue_depth p50 p95 p99 timeouts fallback budget_exhausted cache_hit cache_miss; do
        printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
          "${service}" "${path}" "${request_count}" "${batch_size}" "${queue_depth}" "${p50}" "${p95}" "${p99}" \
          "${timeouts}" "${fallback}" "${budget_exhausted}" "${cache_hit}" "${cache_miss}" >>"${REPORT_MD}"
      done
  fi

  if [[ -s "${RUST_RECOMMENDATION_METRICS_JSON}" ]]; then
    jq -r '[.service, .source, (.request_count // "n/a"), (.batch_size // "n/a"), (.queue_depth // "n/a"), (.p50_us // "n/a"), (.p95_us // "n/a"), (.p99_us // "n/a"), (.timeouts // "n/a"), (if .fallback == null then "n/a" else .fallback end), (if .budget_exhausted == null then "n/a" else .budget_exhausted end), (.cache_hit // "n/a"), (.cache_miss // "n/a")] | @tsv' "${RUST_RECOMMENDATION_METRICS_JSON}" |
      while IFS=$'\t' read -r service path request_count batch_size queue_depth p50 p95 p99 timeouts fallback budget_exhausted cache_hit cache_miss; do
        printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
          "${service}" "${path}" "${request_count}" "${batch_size}" "${queue_depth}" "${p50}" "${p95}" "${p99}" \
          "${timeouts}" "${fallback}" "${budget_exhausted}" "${cache_hit}" "${cache_miss}" >>"${REPORT_MD}"
      done
  fi

  if [[ -s "${CPP_METRICS_JSON}" ]]; then
    jq -r '.metrics[] | [
      "cpp-graph",
      .name,
      (.request_count // "n/a"),
      (.batch_size // "n/a"),
      (.queue_depth // "n/a"),
      (.p50_us // "n/a"),
      (.p95_us // "n/a"),
      (.p99_us // "n/a"),
      (.timeouts // "n/a"),
      (if .fallback == null then "n/a" else .fallback end),
      (if .budget_exhausted == null then "n/a" else .budget_exhausted end),
      (.cache_hit // "n/a"),
      (.cache_miss // "n/a")
    ] | @tsv' "${CPP_METRICS_JSON}" |
      while IFS=$'\t' read -r service path request_count batch_size queue_depth p50 p95 p99 timeouts fallback budget_exhausted cache_hit cache_miss; do
        printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
          "${service}" "${path}" "${request_count}" "${batch_size}" "${queue_depth}" "${p50}" "${p95}" "${p99}" \
          "${timeouts}" "${fallback}" "${budget_exhausted}" "${cache_hit}" "${cache_miss}" >>"${REPORT_MD}"
      done
  fi

  if [[ -s "${INFRA_LOAD_METRICS_JSON}" ]]; then
    jq -r '.results[] | [
      .service,
      .name,
      (.request_count // "n/a"),
      (.batch_size // "n/a"),
      (.queue_depth // "n/a"),
      (.p50_us // "n/a"),
      (.p95_us // "n/a"),
      (.p99_us // "n/a"),
      (.timeouts // "n/a"),
      (if .fallback == null then "n/a" else .fallback end),
      (if .budget_exhausted == null then "n/a" else .budget_exhausted end),
      (.cache_hit // "n/a"),
      (.cache_miss // "n/a")
    ] | @tsv' "${INFRA_LOAD_METRICS_JSON}" |
      while IFS=$'\t' read -r service path request_count batch_size queue_depth p50 p95 p99 timeouts fallback budget_exhausted cache_hit cache_miss; do
        printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
          "${service}" "${path}" "${request_count}" "${batch_size}" "${queue_depth}" "${p50}" "${p95}" "${p99}" \
          "${timeouts}" "${fallback}" "${budget_exhausted}" "${cache_hit}" "${cache_miss}" >>"${REPORT_MD}"
      done
  fi

  cat >>"${REPORT_MD}" <<EOF

## Regression Conclusion

EOF

  if [[ -s "${GO_REGRESSION_MD}" ]]; then
    cat "${GO_REGRESSION_MD}" >>"${REPORT_MD}"
    printf '\n' >>"${REPORT_MD}"
  fi

  if [[ -s "${RUST_GATEWAY_REGRESSION_MD}" ]]; then
    cat "${RUST_GATEWAY_REGRESSION_MD}" >>"${REPORT_MD}"
    printf '\n' >>"${REPORT_MD}"
  fi

  if [[ -s "${RUST_RECOMMENDATION_REGRESSION_MD}" ]]; then
    cat "${RUST_RECOMMENDATION_REGRESSION_MD}" >>"${REPORT_MD}"
    printf '\n' >>"${REPORT_MD}"
  fi

  if [[ -s "${CPP_REGRESSION_JSON}" ]]; then
    cat "${CPP_REGRESSION_MD}" >>"${REPORT_MD}"
  elif [[ -z "${BASELINE_JSON}" ]]; then
    printf 'No baseline JSON was provided; regression comparison was not evaluated.\n' >>"${REPORT_MD}"
  else
    printf 'Regression comparison was not evaluated because optimized C++ bench JSON is unavailable.\n' >>"${REPORT_MD}"
  fi

  cat >>"${REPORT_MD}" <<EOF

## Cross-Service Validation Notes

- Go delivery and Rust gateway/recommendation contribute local hot-path fixture JSON and p95/p99 regression checks.
- Optional infra load fixtures cover Redis Stream lag/PEL/batch ACK, wake publish, Mongo reservation/outbox bulk, gateway Redis fanout/WebSocket connect, recommendation HTTP hit/miss, and C++ snapshot publish/refresh evidence when `PERF_RUN_INFRA_LOAD=true`.
- C++ graph bench JSON is the authoritative implemented gate for graph kernel Phase 3 p95/p99 regression checks.
- The gate fails when any matched local fixture or C++ graph bench p95/p99 latency regresses by more than ${REGRESSION_THRESHOLD_PCT}% against the provided baseline.

EOF
}

require_jq
write_initial_report

if [[ "${RUN_CHECKS}" == "true" ]]; then
  run_default_checks
else
  append_report_check "gate-checks" "PERF_RUN_CHECKS=false" 0 "not-run"
  append_json_check "gate-checks" "PERF_RUN_CHECKS=false" 0 "not-run"
fi

run_cpp_bench_if_needed
run_infra_load_if_enabled
extract_cpp_metrics
extract_infra_load_metrics
extract_service_gate_metrics
compare_fixture_regression "go_delivery" "Go Delivery" "${GO_BASELINE_JSON}" "${GO_PERF_JSON}" "${GO_REGRESSION_JSON}" "${GO_REGRESSION_MD}" || true
compare_fixture_regression "rust_gateway" "Rust Gateway" "${RUST_GATEWAY_BASELINE_JSON}" "${RUST_GATEWAY_PERF_JSON}" "${RUST_GATEWAY_REGRESSION_JSON}" "${RUST_GATEWAY_REGRESSION_MD}" || true
compare_fixture_regression "rust_recommendation" "Rust Recommendation" "${RUST_RECOMMENDATION_BASELINE_JSON}" "${RUST_RECOMMENDATION_PERF_JSON}" "${RUST_RECOMMENDATION_REGRESSION_JSON}" "${RUST_RECOMMENDATION_REGRESSION_MD}" || true
compare_cpp_regression || true
append_metrics_report

FAILURES="$(jq -r '.failure_count' "${SUMMARY_JSON}")"
echo "report: ${REPORT_MD}"
exit "${FAILURES}"
