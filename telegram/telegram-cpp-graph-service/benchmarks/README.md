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

The gate is intentionally loose by default. It fails when comparable p50/p95
latencies regress by more than 20 percent, p99 regresses by more than 2x,
throughput drops by more than 15 percent, or memory grows by more than 50
percent. The current run is sampled three times by default and compared using
median latency/throughput. Override with `GRAPH_BENCH_VERIFY_SAMPLE_COUNT`,
`GRAPH_BENCH_LATENCY_REGRESSION_FACTOR`,
`GRAPH_BENCH_TAIL_LATENCY_REGRESSION_FACTOR`, `GRAPH_BENCH_THROUGHPUT_REGRESSION_FACTOR`,
and `GRAPH_BENCH_MEMORY_REGRESSION_FACTOR`.
