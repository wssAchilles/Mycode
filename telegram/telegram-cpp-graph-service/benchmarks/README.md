# Graph Service Benchmarks

This directory holds local benchmark baselines generated from the synthetic
`graph-store-bench` target.

The baseline is machine-dependent. Generate or refresh it on the target host:

```sh
bash scripts/update_graph_bench_baseline.sh
```

Then run the regression gate:

```sh
bash scripts/check_graph_bench.sh benchmarks/graph_store_baseline.txt
```

The gate is intentionally loose by default and fails when comparable metrics
regress by more than 20 percent.
