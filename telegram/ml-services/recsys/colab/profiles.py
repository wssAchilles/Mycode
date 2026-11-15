"""Google Colab 账号隔离配置与预定义训练算力规格表。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


@dataclass(frozen=True)
class ColabAccountConfig:
    """
    单一授权 Colab 账号配置（仅使用用户当前绑定并具备算力池的 acct1/ADC 凭证）。
    """

    cloudsdk_config: str = "~/.config/gcloud-colab-1"
    colab_config: str = "~/.config/colab-cli/acct1.json"
    auth_mode: str = "adc"
    request_timeout_sec: int = 300
    colab_bin: str = "colab"

    def resolved_cloudsdk_dir(self) -> str:
        return str(Path(self.cloudsdk_config).expanduser())

    def resolved_colab_config_path(self) -> str:
        return str(Path(self.colab_config).expanduser())

    def base_cli_args(self) -> List[str]:
        return [
            self.colab_bin,
            "--auth",
            self.auth_mode,
            "--config",
            self.resolved_colab_config_path(),
        ]


@dataclass(frozen=True)
class ColabTrainingProfile:
    """预定义的 Colab 算力规格与推荐训练任务组合。"""

    name: str
    task: str  # "smoke" | "two-tower" | "kuairand-prep" | "phoenix-v2" | "phoenix-v2-pretrain" | "phoenix-v2-finetune" | "sidecars"
    gpu: Optional[str] = None
    high_mem: bool = False
    scale: str = "mini"
    epochs: int = 5
    batch_size: int = 64
    max_history: int = 64
    max_candidates: int = 32
    lr: float = 3e-4
    backbone_lr_scale: float = 1.0
    reset_id_hashes_on_init: bool = False
    checkpoint_role: str = "serving"  # "serving" | "pretrain_only"
    estimated_cu_per_hr: float = 0.05
    description: str = ""


COLAB_PROFILES: Dict[str, ColabTrainingProfile] = {
    "smoke-cpu": ColabTrainingProfile(
        name="smoke-cpu",
        task="smoke",
        gpu=None,
        high_mem=False,
        scale="mini",
        epochs=1,
        batch_size=8,
        max_history=16,
        max_candidates=8,
        lr=3e-4,
        checkpoint_role="serving",
        estimated_cu_per_hr=0.05,
        description="CPU 端到端链路冒烟验证（极低开销，校验代码打包、V2 训练、侧车及契约门禁）",
    ),
    "two-tower-t4": ColabTrainingProfile(
        name="two-tower-t4",
        task="two-tower",
        gpu="T4",
        high_mem=True,
        scale="mini",
        epochs=6,
        batch_size=2048,
        lr=1e-3,
        checkpoint_role="serving",
        estimated_cu_per_hr=1.96,
        description="Two-Tower 双塔对比学习召回（InfoNCE + Log-Q 纠偏）、全量 MLP 向量导出与 FAISS 构建",
    ),
    "kuairand-prep-cpu": ColabTrainingProfile(
        name="kuairand-prep-cpu",
        task="kuairand-prep",
        gpu=None,
        high_mem=True,
        scale="medium",
        epochs=1,
        batch_size=64,
        max_history=64,
        max_candidates=32,
        checkpoint_role="pretrain_only",
        estimated_cu_per_hr=0.10,
        description="High-RAM CPU 将 KuaiRand-27K 原始日志流式转换为严格 PIT Phoenix V2 分片与无偏随机评估集",
    ),
    "phoenix-v2-mini-t4": ColabTrainingProfile(
        name="phoenix-v2-mini-t4",
        task="phoenix-v2",
        gpu="T4",
        high_mem=True,
        scale="mini",
        epochs=8,
        batch_size=64,
        checkpoint_role="serving",
        estimated_cu_per_hr=1.96,
        description="Phoenix V2 Mini（128d, 4层）候选隔离多任务排序训练与 CPU 延迟基准验收",
    ),
    "phoenix-v2-medium-a100": ColabTrainingProfile(
        name="phoenix-v2-medium-a100",
        task="phoenix-v2",
        gpu="A100",
        high_mem=True,
        scale="medium",
        epochs=10,
        batch_size=128,
        checkpoint_role="serving",
        estimated_cu_per_hr=13.0,
        description="Phoenix V2 Medium（256d, 6层）高容量排序主塔混合精度训练",
    ),
    "phoenix-v2-pretrain-t4": ColabTrainingProfile(
        name="phoenix-v2-pretrain-t4",
        task="phoenix-v2-pretrain",
        gpu="T4",
        high_mem=True,
        scale="medium",
        epochs=4,
        batch_size=128,
        max_history=64,
        max_candidates=32,
        lr=3e-4,
        checkpoint_role="pretrain_only",
        estimated_cu_per_hr=1.96,
        description="Phoenix V2 Medium KuaiRand-27K T4 多任务骨干预训练 + log_random 无偏评估（严格隔离发布）",
    ),
    "phoenix-v2-pretrain-a100": ColabTrainingProfile(
        name="phoenix-v2-pretrain-a100",
        task="phoenix-v2-pretrain",
        gpu="A100",
        high_mem=True,
        scale="medium",
        epochs=4,
        batch_size=256,
        max_history=64,
        max_candidates=32,
        lr=4e-4,
        checkpoint_role="pretrain_only",
        estimated_cu_per_hr=13.0,
        description="Phoenix V2 Medium KuaiRand-27K A100 BF16 高吞吐预训练 + log_random 无偏评估（严格隔离发布）",
    ),
    "phoenix-v2-finetune-t4": ColabTrainingProfile(
        name="phoenix-v2-finetune-t4",
        task="phoenix-v2-finetune",
        gpu="T4",
        high_mem=True,
        scale="auto",
        epochs=6,
        batch_size=64,
        max_history=64,
        max_candidates=32,
        lr=3e-4,
        backbone_lr_scale=0.1,
        reset_id_hashes_on_init=True,
        checkpoint_role="serving",
        estimated_cu_per_hr=1.96,
        description="加载预训练主干并重置 ID 哈希（0.1x 主干差分学习率 + 回放锚点）在本域精调与侧车联产",
    ),
    "sidecars-cpu": ColabTrainingProfile(
        name="sidecars-cpu",
        task="sidecars",
        gpu=None,
        high_mem=False,
        scale="mini",
        epochs=1,
        batch_size=64,
        checkpoint_role="serving",
        estimated_cu_per_hr=0.08,
        description="SocialPhoenix Linear + RealGraph GBT + WeightedScorer Platt 校准侧车联合训练",
    ),
    "v3-sid-twotower-a100": ColabTrainingProfile(
        name="v3-sid-twotower-a100",
        task="v3-sid-twotower",
        gpu="A100",
        high_mem=True,
        scale="large",
        epochs=10,
        batch_size=256,
        max_history=128,
        max_candidates=64,
        lr=1e-3,
        checkpoint_role="serving",
        estimated_cu_per_hr=13.0,
        description="V3 Stage 1+2：6x256 RQ-VAE + 多语言蒸馏文本编码器 + 无 ID MoL 双塔与 HNSW-SQ8 建库",
    ),
    "v3-phoenix-teacher-a100": ColabTrainingProfile(
        name="v3-phoenix-teacher-a100",
        task="v3-phoenix-teacher",
        gpu="A100",
        high_mem=True,
        scale="large",
        epochs=8,
        batch_size=64,
        max_history=128,
        max_candidates=64,
        lr=3e-4,
        checkpoint_role="pretrain_only",
        estimated_cu_per_hr=13.0,
        description="V3 Stage 3 Teacher：512d/10L Phoenix V3 + Muon+AdamW + Plackett-Luce + CREAD-30 训练",
    ),
    "v3-phoenix-distill-l4": ColabTrainingProfile(
        name="v3-phoenix-distill-l4",
        task="v3-phoenix-distill",
        gpu="L4",
        high_mem=True,
        scale="medium",
        epochs=10,
        batch_size=64,
        max_history=128,
        max_candidates=64,
        lr=4e-4,
        checkpoint_role="serving",
        estimated_cu_per_hr=4.5,
        description="V3 Stage 3+4+5 Student 蒸馏：256d/6L DE-RRD + 经验贝叶斯校准 + INT8 ONNX 导出验证",
    ),
    "v3-full-pipeline-a100": ColabTrainingProfile(
        name="v3-full-pipeline-a100",
        task="v3-full-pipeline",
        gpu="A100",
        high_mem=True,
        scale="large",
        epochs=8,
        batch_size=128,
        max_history=128,
        max_candidates=64,
        lr=3e-4,
        checkpoint_role="serving",
        estimated_cu_per_hr=13.0,
        description="V3 全链路端到端流水线（Stage 1-5 联产 + Ablations ①-⑤ + ServingManifestV3 SHA-256 签名）",
    ),
}
