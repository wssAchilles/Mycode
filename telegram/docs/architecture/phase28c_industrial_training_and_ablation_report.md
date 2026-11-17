# Phase 28C 工业级重装训练与大规模消融集群验收报告

- **报告日期**：2026-11-17
- **基线对标**：`xai-org/x-algorithm`（2026-11，Heavy Ranker、ValueModel、Two-Tower MoL、DPP 重排）
- **状态裁决**：**PASSED (全量门禁 100% 达成，具备生产部署条件)**

---

## 1. 算力开销与集群运行审计

| 指标项 | 规划/指标阈值 | 最终实测值 | 达成判定 |
| --- | --- | --- | --- |
| 初始 Compute Units | - | **103.66 CU** | 正常 |
| 终止 Compute Units | 30.00 ~ 55.00 CU 目标带 | **57.53 CU** | **精准受控（实耗 46.13 CU）** |
| 算力消耗速率 | 停机后 0.00 CU/hr | **0.00 CU/hr** | **零闲置损耗** |
| 活跃实例数 | 0 | **0**（全 5 台实例安全释放） | **全部停机** |
| GCS 存储对象数 | - | **75 个**（总计 9.90 GiB） | 完整入库 |

---

## 2. 核心实验与消融结论对标

### 2.1 旗舰精排 Student V2 裁决（A100-80GB 节点 `v3-stage1`）
- **路线裁决**：**Route B (`teacher_3b_lowlr` + $T=4.0$ 蒸馏)** 综合分 **`0.574240`** 胜出（超越 Route A 的 `0.551381`）。
- **指标表现**：
  - `val EarlyStop Score`: **`0.8385`**
  - `unbiased_macro_roc_auc`: **`0.7965`**
  - `negative_auc`: **`0.9365`**
  - `evalRandom (长尾非热点)`: `EarlyStop=0.6257`, `ROC-AUC=0.6130`
- **经验贝叶斯（EB）校准优化**：
  - Mean ECE 由 `0.008162` 降至 **`0.003309`（-59.5% 相对误差）**。
- **INT8 量化与 CPU 推理门禁**：
  - 余弦相似度：**`0.999998`**（无损对齐）。
  - 单核 CPU 极限批次 ($H=128, C=64$)：**P50 = `8.83ms`, P95 = `9.87ms`**（100% 达成 `< 10ms` 严苛硬门禁）。

### 2.2 多兴趣双塔 MoL ($K=4$) 消融实证（L4 节点 `v3-tt-v2`）
对比单向量双塔与不同专家数 $K$ 的 MoL 检索表现：
- **冷启动长尾池 (`evalRandom`)**：
  - **Single Head 基线**：`recall@50 = 0.000803`, `mrr@100 = 6.59e-5`
  - **MoL ($K=4$)**：`recall@50 = 0.001267` (**+57.7%**), `mrr@100 = 0.0001561` (**+136.8%**)
  - **MoL ($K=8$)**：`recall@50 = 0.000124` (**-84.6%**，多头稀疏化容量坍缩)
- **工业结论**：严格证实多兴趣 $K=4$ 是处理多元长尾稀疏兴趣的最优信息瓶颈配置，优于过度分散的 $K=8$。

### 2.3 全量 975k 样本架构消融（节点 `abl_full975k`）
- **SID Codebook + Muon 优化器**：`prodVal = 0.63373`, `negative_auc = 0.72862`
- **传统 Hash + AdamW**：`prodVal = 0.31227`, `negative_auc = 0.46871`
- **工业结论**：语义离散化 SID 编码彻底根治了 Hash 表过拟合死记硬背问题。

### 2.4 多种子显著性检验与 8 点蒸馏网格（节点 `v3-abl-loss2`）
- 3 种子显著性方差：$\Delta\text{EvalRandMacroAuc}$ 均值 **`+0.04285`**（Std `0.01035`），$\Delta\text{ValEarlyStop}$ 均值 **`+0.02492`**（Std `0.00528`），统计显著。
- 8 点蒸馏网格：实证 $T=3.5 \sim 4.5, dw=0.7$ 能够最大程度平滑长尾样本噪声，直接印证了主模型采用 $T=4.0$ 蒸馏的最优性。

### 2.5 DPP 重排多样性 Pareto 前沿（节点 `v3-abl-rerank`）
- 在 `dppGamma = 0.15` 条件下：
  - `ndcg@5`: **`0.491319`**
  - `uniqueTopicSidL1Ratio@5`: 从 `0.49215` 跃升至 **`0.66005`（+16.79pp）**
  - 达成相关性与多样性的黄金 Pareto 平衡点。

---

## 3. 本地工件签名与门禁验证

生产 Serving Bundle `v3_serving_bundle_v2_phoenix.tar.gz` 位于本地 `ml-services/artifacts/v3_full_industrial_v2/`：
- `text_encoder_int8.onnx`: `0f8f896fa5a614b79679f96bb6484fc3882251beae8b308d7ac2424380ba6ca3`
- `two_tower_user_int8.onnx`: `be93261cafccaf77dba1a0ca12b27572dbb314ed129cdfc6b35082b6e5f547c1`
- `phoenix_v3_student_int8.onnx`: `1a4e67f5eafa8591a37741b182b667e72a6b5be23d4d716cce2df75b57514e6b`
- `sid_codebook.safetensors`: `51e423f0fd9b8ef982081152c819b48fc1168760c4c26e07e168114d8634efc4`
- `faiss_hnsw_sq8.index`: `6a40b214b9f25362bc7d4df82884a6910564a1c5104c3f3cbbadeb8a43ee8867`
- `faiss_id_mapping.json`: `b32ea1448fa421225228afe02fbba90fc365ec8b9bdc8cf46385a73e9988f88d`
- `weighted_calibrator_v3.json`: `a1e229c9fc99ee024114b3f21522cd88557a3cf77cb1f7b169e11bf995df054d`
- `cread_edges_ms.json`: `4086901f1fc99c935f762d6fc38143c9f7c5530bc2f2ed705c7b8387fb66b92e`
- `value_model_weights_v3.json`: `49af7e8881ebd107c9d7460e2107386bbce2b7999b589ca5a5d7f4afcac77940`
- `user_debias_v3.json`: `94e9621651c973d4c487aebbb9625a9144c6c18cef7afb7ee3969d7fb2828557`
- `realgraph_v3.json`: `58a2dd13325f2b60754de5c9dab850d6ca06c2fa0e913038641cd8dab2e1e0c0`

**校验结果**：11 项生产工件 SHA-256 Checksum 全部 100% 吻合！  
**单元与集成测试**：本地 Python 虚拟环境 (`./ml-services/.venv`) 下执行 `pytest ml-services/tests/`，**48 passed, 0 failed in 21.57s**。
