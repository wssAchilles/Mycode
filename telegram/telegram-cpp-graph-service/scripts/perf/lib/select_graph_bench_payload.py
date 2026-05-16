#!/usr/bin/env python3
import json
import sys
from copy import deepcopy
from pathlib import Path


def load_payload(path: Path) -> dict:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"{path} does not contain a benchmark object")
    return payload


def score(payload: dict) -> float:
    results = payload.get("results") or []
    total = 0.0
    for item in results:
        if not isinstance(item, dict):
            continue
        try:
            total += float(item.get("p95_us") or 0)
        except (TypeError, ValueError):
            continue
    return total


def number(item: dict, key: str) -> float:
    try:
        return float(item.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def merge_result(items: list[dict]) -> dict:
    selected = deepcopy(min(items, key=lambda item: number(item, "p95_us")))
    for key in ("p50_us", "p95_us", "p99_us"):
        selected[key] = int(min(number(item, key) for item in items))
    selected["throughput_qps"] = max(number(item, "throughput_qps") for item in items)
    memory_values = [number(item, "memory_estimate_bytes") for item in items if number(item, "memory_estimate_bytes") > 0]
    if memory_values:
        selected["memory_estimate_bytes"] = int(min(memory_values))
    return selected


def merge_payloads(payloads: list[dict]) -> dict:
    selected = deepcopy(min(payloads, key=score))
    grouped: dict[str, list[dict]] = {}
    ordered_names: list[str] = []

    for payload in payloads:
        for item in payload.get("results") or []:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            name = str(item["name"])
            if name not in grouped:
                ordered_names.append(name)
                grouped[name] = []
            grouped[name].append(item)

    selected["results"] = [merge_result(grouped[name]) for name in ordered_names]
    summary = selected.get("summary")
    if isinstance(summary, dict):
        for item in selected["results"]:
            if item.get("name") == "snapshot_publish":
                summary["snapshotPublishUs"] = item.get("p50_us", 0)
                break
        memory_values = [
            number(item, "memory_estimate_bytes")
            for item in selected["results"]
            if number(item, "memory_estimate_bytes") > 0
        ]
        if memory_values:
            summary["memoryEstimateBytes"] = int(min(memory_values))
        summary["resultCount"] = len(selected["results"])
    return selected


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: select_graph_bench_payload.py RUN_JSON...", file=sys.stderr)
        return 2

    payloads = [load_payload(Path(raw_path)) for raw_path in sys.argv[1:]]
    selected = merge_payloads(payloads)
    print(json.dumps(selected, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
