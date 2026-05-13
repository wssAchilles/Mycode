#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def load_results(path: Path) -> dict[str, dict]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError(f"{path} must contain a JSON array")
    results: dict[str, dict] = {}
    for item in payload:
        name = item.get("name")
        if not name:
            raise ValueError(f"{path} contains a benchmark without name")
        results[str(name)] = item
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--latency-factor", type=float, default=1.2)
    parser.add_argument("--throughput-factor", type=float, default=0.85)
    parser.add_argument("--memory-factor", type=float, default=1.5)
    args = parser.parse_args()

    current = load_results(Path(args.current))
    baseline = load_results(Path(args.baseline))
    failures: list[str] = []

    for name, base in baseline.items():
        item = current.get(name)
        if item is None:
            failures.append(f"{name}: missing current benchmark")
            continue

        for field in ("p50_us", "p95_us", "p99_us"):
            base_value = float(base.get(field, 0) or 0)
            current_value = float(item.get(field, 0) or 0)
            if base_value > 0 and current_value > base_value * args.latency_factor:
                failures.append(f"{name}: {field}={current_value:g} baseline={base_value:g}")

        base_qps = float(base.get("throughput_qps", 0) or 0)
        current_qps = float(item.get("throughput_qps", 0) or 0)
        if base_qps > 0 and current_qps < base_qps * args.throughput_factor:
            failures.append(f"{name}: throughput_qps={current_qps:g} baseline={base_qps:g}")

        base_memory = float(base.get("memory_estimate_bytes", 0) or 0)
        current_memory = float(item.get("memory_estimate_bytes", 0) or 0)
        if base_memory > 0 and current_memory > base_memory * args.memory_factor:
            failures.append(f"{name}: memory_estimate_bytes={current_memory:g} baseline={base_memory:g}")

    if failures:
        for failure in failures:
            print(f"benchmark regression: {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
