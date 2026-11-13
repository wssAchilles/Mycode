"""Colab CLI v0.8.0 训练编排、脱敏传参、代码安全打包与发布门禁测试。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
import tarfile

import pytest

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.colab.orchestrator import (
    COLAB_PROFILES,
    ColabAccountConfig,
    build_code_bundle,
    build_colab_cli_plan,
    build_colab_subprocess_env,
    dispatch_colab_job,
    evaluate_promotion_gate,
    format_redacted_command,
    render_remote_worker_script,
)
from recsys.contracts.actions import ACTION_TYPE_MAP
from recsys.contracts.artifacts import build_serving_manifest
from recsys.training.calibration_and_sidecars import train_social_phoenix_linear
from recsys.training.phoenix_v2_trainer import PhoenixV2TrainConfig, train_phoenix_v2


def test_colab_cli_plan_flags_acct1_only_and_secret_redaction(tmp_path: Path) -> None:
    """确认生成精确匹配 colab-cli v0.8.0 的参数、单账号隔离及密钥脱敏输出。"""
    acc = ColabAccountConfig()
    bundle = tmp_path / "bundle.tar.gz"
    worker = tmp_path / "worker.py"

    t4_plan = build_colab_cli_plan(
        profile_name="phoenix-v2-mini-t4",
        account=acc,
        session_name="sess-t4",
        bundle_path=bundle,
        worker_script_path=worker,
        remote_env={
            "GCS_BUCKET": "telegram-467705-recsys",
            "MONGO_URI": "mongodb+srv://user:supersecret@cluster.example/db",
        },
    )
    assert t4_plan["usage"][:5] == ["colab", "--auth", "adc", "--config", acc.resolved_colab_config_path()]
    assert "acct1.json" in t4_plan["usage"][4]
    assert "--gpu" in t4_plan["new"] and "T4" in t4_plan["new"]
    assert "--high-mem" in t4_plan["new"]
    assert "--timeout" in t4_plan["exec"] and "0" in t4_plan["exec"]

    redacted = format_redacted_command(t4_plan["exec"])
    assert "supersecret" not in redacted
    assert "MONGO_URI=<REDACTED>" in redacted
    assert "GCS_BUCKET=telegram-467705-recsys" in redacted

    cpu_plan = build_colab_cli_plan(
        profile_name="smoke-cpu",
        account=acc,
        session_name="sess-cpu",
        bundle_path=bundle,
        worker_script_path=worker,
    )
    assert "--gpu" not in cpu_plan["new"]
    assert "--high-mem" not in cpu_plan["new"]

    env = build_colab_subprocess_env(acc)
    assert env["CLOUDSDK_CONFIG"].endswith("gcloud-colab-1")
    assert env["COLAB_CLI_REQUEST_TIMEOUT"] == "300"


def test_build_code_bundle_excludes_secrets_and_venv(tmp_path: Path) -> None:
    """验证远端同步压缩包严格排除 .env、密钥 JSON、.venv 与大体积数据目录。"""
    fake_root = tmp_path / "ml-services"
    (fake_root / "recsys").mkdir(parents=True)
    (fake_root / "scripts").mkdir(parents=True)
    (fake_root / ".venv" / "lib").mkdir(parents=True)
    (fake_root / "recsys" / "__pycache__").mkdir(parents=True)
    (fake_root / "data").mkdir(parents=True)

    (fake_root / "requirements.txt").write_text("torch\n", encoding="utf-8")
    (fake_root / "recsys" / "safe.py").write_text("x = 1\n", encoding="utf-8")
    (fake_root / "scripts" / "train_sidecars.py").write_text("y = 2\n", encoding="utf-8")
    (fake_root / "scripts" / ".env.prod").write_text("MONGO_URI=secret\n", encoding="utf-8")
    (fake_root / "scripts" / "service_account_key.json").write_text("{}\n", encoding="utf-8")
    (fake_root / ".venv" / "lib" / "pkg.py").write_text("z = 3\n", encoding="utf-8")
    (fake_root / "recsys" / "__pycache__" / "safe.cpython-311.pyc").write_bytes(b"pyc")
    (fake_root / "data" / "huge.npy").write_bytes(b"data")

    out_tar = tmp_path / "bundle.tar.gz"
    info = build_code_bundle(fake_root, out_tar)
    assert info["includedFiles"] == 3
    assert info["excludedFiles"] >= 3

    with tarfile.open(out_tar, "r:gz") as tar:
        names = tar.getnames()
    assert set(names) == {"requirements.txt", "recsys/safe.py", "scripts/train_sidecars.py"}


def test_promotion_gate_blocks_corrupt_checksum_and_high_latency(tmp_path: Path) -> None:
    """校验门禁能对高延迟、权重损坏与侧车契约违规执行 Fail-Closed 拦截。"""
    data_dir = tmp_path / "data"
    models_dir = tmp_path / "models"
    data_dir.mkdir(parents=True)
    base_ts = datetime(2026, 11, 10, 0, 0, 0, tzinfo=timezone.utc)
    samples = [
        {
            "user_id": f"u_{i % 3}",
            "history": [("hp_0", "ha_0", ACTION_TYPE_MAP["like"], 1), ("hp_1", "ha_1", ACTION_TYPE_MAP["click"], 2)],
            "candidate_post_id": f"cp_{i}",
            "candidate_author_id": "ha_0" if i % 2 == 0 else "ha_1",
            "labels": {"click": float(i % 2 == 0), "like": float(i % 4 == 0), "reply": 0.0, "repost": 0.0, "quote": 0.0, "share": 0.0, "dwell": float(i % 2 == 0), "video_view": 0.0, "follow_author": 0.0, "not_interested": float(i % 2 != 0), "block_author": 0.0, "mute_author": 0.0, "report": 0.0},
            "dwell_ms": 5000 if i % 2 == 0 else 100,
            "in_network": i % 2 == 0,
            "has_video": False,
            "action_time": (base_ts + timedelta(minutes=i * 5)).isoformat(),
            "is_positive": i % 2 == 0,
        }
        for i in range(16)
    ]

    report = train_phoenix_v2(
        PhoenixV2TrainConfig(
            data_dir=data_dir,
            models_dir=models_dir,
            scale="mini",
            epochs=1,
            batch_size=8,
            max_history=8,
            max_candidates=8,
            val_ratio=0.0,
        ),
        samples=samples,
    )
    train_social_phoenix_linear(samples, models_dir=models_dir)
    manifest = build_serving_manifest(
        version="gate_test",
        profile="phoenix-v2",
        faiss_index_type="ivf_pq",
        models_dir=models_dir,
        data_dir=data_dir,
        include_checksums=True,
    )
    (data_dir / "serving_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    ok, reasons, _ = evaluate_promotion_gate(
        profile_name="phoenix-v2-mini-t4",
        models_dir=models_dir,
        data_dir=data_dir,
        train_report=report,
        max_cpu_p95_ms=5000.0,
    )
    assert ok, reasons

    # 1. P95 延迟超阈值必须拦截
    ok_slow, reasons_slow, _ = evaluate_promotion_gate(
        profile_name="phoenix-v2-mini-t4",
        models_dir=models_dir,
        data_dir=data_dir,
        train_report={"cpuBenchmark": {"cpuFp32P95Ms": 250.0}, "epochs": [{"trainLoss": 0.5}]},
        max_cpu_p95_ms=120.0,
    )
    assert not ok_slow and any("cpu_p95_latency_exceeded" in r for r in reasons_slow)

    # 2. 篡改权重字节必须被 SHA-256 拦截
    with open(models_dir / "phoenix_v2_inference.pt", "ab") as f:
        f.write(b"tamper")
    ok_bad, reasons_bad, _ = evaluate_promotion_gate(
        profile_name="phoenix-v2-mini-t4",
        models_dir=models_dir,
        data_dir=data_dir,
        train_report=report,
        max_cpu_p95_ms=5000.0,
    )
    assert not ok_bad and any("checksum_mismatch:phoenixV2Model" in r for r in reasons_bad)


def test_colab_dispatch_dry_run_cli_and_finally_stop_guard(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """验证 colab_dispatch.py dry-run CLI 无算力消耗，以及执行失败时 finally 必发 colab stop。"""
    proc = subprocess.run(
        [
            sys.executable,
            str(_ML_SERVICES_ROOT / "scripts" / "colab_dispatch.py"),
            "--dry-run",
            "--profile",
            "phoenix-v2-mini-t4",
            "--artifact-version",
            "2026-11-13_v2",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    parsed = json.loads(proc.stdout)
    assert parsed["dryRun"] is True
    assert parsed["gpu"] == "T4"
    assert parsed["highMem"] is True
    assert parsed["localEnv"]["CLOUDSDK_CONFIG"].endswith("gcloud-colab-1")
    assert "--timeout 0" in parsed["commandsRedacted"]["exec"]
    assert Path(parsed["bundle"]["bundlePath"]).exists()
    assert Path(parsed["workerScriptPath"]).exists()

    # 校验生成的 worker 脚本语法完整且包含心跳日志与发布门禁调用
    worker_text = render_remote_worker_script(
        profile=COLAB_PROFILES["smoke-cpu"],
        artifact_version="smoke_test",
    )
    compile(worker_text, "worker_smoke.py", "exec")
    assert "[heartbeat]" in worker_text
    assert "evaluate_promotion_gate" in worker_text

    # 模拟 exec 阶段抛出异常时，必须保证触发 stop 释放会话
    calls = []

    def _fake_run(cmd, env=None, check=False):  # noqa: ARG001
        calls.append(cmd)
        if "exec" in cmd:
            raise subprocess.CalledProcessError(1, cmd)
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(subprocess, "run", _fake_run)
    with pytest.raises(subprocess.CalledProcessError):
        dispatch_colab_job(
            profile_name="smoke-cpu",
            artifact_version="fail_stop_test",
            ml_services_dir=_ML_SERVICES_ROOT,
            staging_dir=tmp_path / "staging",
            session_name="sess-guard-test",
            dry_run=False,
        )

    assert ["usage", "new", "upload", "exec", "stop"] == [c[5] for c in calls]
    assert calls[-1][-2:] == ["--session", "sess-guard-test"]
