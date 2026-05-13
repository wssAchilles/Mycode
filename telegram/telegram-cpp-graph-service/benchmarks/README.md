# Graph Service Benchmarks

This directory holds local benchmark baselines generated from the synthetic
`graph-store-bench` target.

The baseline is machine-dependent. Generate or refresh it on the target host:

```sh
bash scripts/perf/update_graph_bench_baseline.sh
```

Then run the regression gate:

```sh
GRAPH_BENCH_BASELINE_FILE=benchmarks/graph_store_baseline.txt bash scripts/perf/check_graph_bench.sh
```

The gate is intentionally loose by default. It fails when comparable p50/p95/p99
latencies regress by more than 20 percent or throughput drops by more than 15
percent. Override with `GRAPH_BENCH_LATENCY_REGRESSION_FACTOR` and
`GRAPH_BENCH_THROUGHPUT_REGRESSION_FACTOR`.
