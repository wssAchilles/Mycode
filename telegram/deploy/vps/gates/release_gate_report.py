#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def load_json(path: Path, fallback_capability: str) -> dict:
    if not path.exists():
        return {
            "capability": fallback_capability,
            "currentBlocker": "gate_output_missing",
            "recommendedAction": "inspect_release_gate_execution",
            "readinessState": "blocked",
        }
    return json.loads(path.read_text())


def parse_result(value: str) -> tuple[str, Path]:
    name, raw_path = value.split("=", 1)
    return name, Path(raw_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-path", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--remote-target", default="")
    parser.add_argument("--ops-base-url", required=True)
    parser.add_argument("--allow-waiting-for-traffic", action="store_true")
    parser.add_argument("--check-image-manifests", action="store_true")
    parser.add_argument("--check-remote-runtime", action="store_true")
    parser.add_argument("--run-ops-checks", action="store_true")
    parser.add_argument("--print-json", action="store_true")
    parser.add_argument("--result", action="append", default=[])
    args = parser.parse_args()

    failures = []
    warnings = []
    results = {}
    remote_runtime = {}

    for item in args.result:
        key, path = parse_result(item)
        payload = load_json(path, key)
        results[key] = payload

        if key == "remote_runtime":
            remote_runtime = {
                "currentRelease": payload.get("currentRelease", ""),
                "composePs": payload.get("composePs", ""),
                "gatewayHealth": payload.get("gatewayHealth", ""),
            }

        if key == "platform_probe" and "data" in payload:
            data = payload.get("data") or {}
            platform_probe = data.get("platformProbe") or {}
            if not bool(platform_probe.get("available")):
                failures.append({
                    "capability": key,
                    "currentBlocker": platform_probe.get("error") or "platform_probe_unavailable",
                    "recommendedAction": "inspect_delivery_consumer_platform_probe",
                })
            continue

        blocker = payload.get("currentBlocker") or "none"
        state = payload.get("readinessState") or ("ready" if blocker == "none" else "blocked")
        if blocker == "none" or state == "skipped":
            continue
        if blocker == "waiting_for_traffic" and args.allow_waiting_for_traffic:
            warnings.append({
                "capability": key,
                "currentBlocker": blocker,
                "recommendedAction": payload.get("recommendedAction"),
            })
            continue
        failures.append({
            "capability": key,
            "currentBlocker": blocker,
            "recommendedAction": payload.get("recommendedAction"),
        })

    report = {
        "schemaVersion": "release_gate_report_v1",
        "ok": not failures,
        "status": "blocked" if failures else ("warning" if warnings else "ready"),
        "releaseTag": args.release_tag,
        "remoteTarget": args.remote_target,
        "opsBaseUrl": args.ops_base_url,
        "checks": {
            "imageManifests": args.check_image_manifests,
            "remoteRuntime": args.check_remote_runtime,
            "ops": args.run_ops_checks,
        },
        "allowWaitingForTraffic": args.allow_waiting_for_traffic,
        "failures": failures,
        "warnings": warnings,
        "remoteRuntime": remote_runtime,
        "results": results,
    }

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    print(f"release gate: {report['status']} tag={args.release_tag} report={report_path}")
    for name in sorted(results):
        item = results[name]
        blocker = item.get("currentBlocker") or "none"
        state = item.get("readinessState") or ("ready" if blocker == "none" else "blocked")
        print(f"- {name}: {state} blocker={blocker}")
    if warnings:
        print("warnings:")
        for warning in warnings:
            print(f"- {warning.get('capability')}: {warning.get('currentBlocker')} action={warning.get('recommendedAction')}")
    if failures:
        print("failures:")
        for failure in failures:
            print(f"- {failure.get('capability')}: {failure.get('currentBlocker')} action={failure.get('recommendedAction')}")
    if args.print_json:
        print(json.dumps(report, indent=2, sort_keys=True))

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
