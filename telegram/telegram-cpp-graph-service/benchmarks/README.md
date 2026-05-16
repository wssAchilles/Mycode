# Graph Service Benchmarks

This directory holds local benchmark baselines generated from the synthetic
`graph-store-bench` target.

The baseline is machine-dependent. Generate or refresh it on the target host:

```sh
bash tools/performance/baseline/update_graph_baseline.sh
```

Then run the regression gate:

```sh
bash tools/performance/baseline/compare_graph_baseline.sh
```

The gate emits a stable JSON report and is intentionally loose by default. It
fails when comparable p50/p95/p99 latencies regress by more than 20 percent,
and exceed the small absolute microsecond tolerance, throughput drops by more than 20 percent, or memory grows by more than 50
percent. Override with `GRAPH_BENCH_MAX_REGRESSION_PERCENT`,
`GRAPH_BENCH_ABSOLUTE_LATENCY_TOLERANCE_US`, `GRAPH_BENCH_THROUGHPUT_REGRESSION_PERCENT`,
`GRAPH_BENCH_MEMORY_REGRESSION_PERCENT`, and `GRAPH_BENCH_REPORT_FILE`.
