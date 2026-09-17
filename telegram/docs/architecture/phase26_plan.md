# Phase 26: 实时网关 2B 阶段 Rust Socket 终结器落地与 Node 退役方案

**编制时间**：2026-09-17  
**对标生态**：Discord 实时网关、Centrifugo 实时推送引擎、RFC 6298 / RFC 793、Socket.IO 官方协议、`AGENTS.md` 铁律  
**状态**：待用户审核 (Plan Ready for Review)

---

## 1. 目标与价值阐述 (Executive Summary)

根据系统演化路线，实时网关已完成 Phase 23（Rust Edge Primary），但客户端长连接（WebSocket / Polling）目前仍终结于 Node.js（2A 阶段，`GATEWAY_REALTIME_SOCKET_TERMINATOR=node`）。
Node.js 单线程模型在数万长连接下存在 V8 垃圾回收（Major GC）毛刺、高内存占用（单连接 25KB~35KB）以及事件循环阻塞风险。

**Phase 26 核心使命**：
将长连接终结权彻底交由 Rust 边缘网关（`telegram-rust-gateway`，基于 Tokio + `socketioxide`），实现单连接常驻内存压降至 2KB~4KB（降幅 > 80%）、零 GC 停顿与亚毫秒级 P99 下发延迟；通过灰度分流与连接平滑排空（Connection Draining），使 Node.js 长连接服务平稳退役。

---

## 2. 学术与工程双向调研裁决与证据矩阵

### 2.1 学术理论裁决与数学推导结论
- **裁决结论**：**CONDITIONAL GO（有条件推进）**。
- **排队背压与内存防爆（Little's Law）**：
  推导单连接环形缓冲区深度应设为 $B_{\text{conn}} = 256$（$W_{\max} = 2.5\text{s}, \lambda_{\text{burst}} = 100\text{ msgs/s}$）；整机 10 万并发连接下的理论最大极限物理内存严格收敛至 $13.5\text{GB}$ 以内，具有数学可证明的防 OOM 安全性。采用 **Head-Drop（Drop Oldest）** 策略，保持消息最新鲜度并通过自增 Sequence Gap 驱动客户端主动补发。
- **分布式会话租约（Lease Model with TTL）**：
  推导得出租约有效时间安全区间为：
  $$(K_{\text{retry}} - 1) \cdot T_{\text{ping}} + \Delta_{\text{net\_max}} + \Delta_{\text{redis\_max}} + \epsilon_{\text{skew}} < T_{\text{lease}} \le \Theta_{\text{SLA\_offline}} - \epsilon_{\text{skew}}$$
  **诊断致命缺陷**：当前代码中硬编码的 $3600\text{s}$ TTL 存在长达 1 小时的幽灵会话（Ghost Session）黑洞！必须将其严格修正为理论黄金标称值 **$100\text{s}$**。
- **防惊群退避抖动**：
  采用 **Full Jitter** 指数退避，重连到达率期望为常数 $\lambda(t) = \frac{N}{v_c}$，彻底打破客户端重连周期性脉冲。

### 2.2 工业级工程对标与开源实践
- **对标系统**：Discord 网关（Rust/Elixir 接入层与业务逻辑严格解耦）、Centrifugo（动态房间订阅、本地活跃连接索引过滤）。
- **选型评定**：`socketioxide` 完美兼容前端已有的 Engine.IO v4 与 Socket.IO 协议帧，零前端改动成本。

---

## 3. 现有代码库致命隐患深度诊断 (Critical Findings)

经过主智能体与工程智能体联合代码走读，诊断出当前 `telegram-rust-gateway` 存在的五大缺陷，必须全部在 Phase 26 修复：

1. **【致命级】`apply_ingress_envelope` 未 await 导致所有 Ingress 事件全部丢失**：
   - 位于 `src/realtime/socket/server.rs`，共有 10 处调用未加 `.await` 亦未 `spawn`；
   - 导致 `SessionOpened`、`SessionHeartbeat`、`PresenceUpdated` 等从未推入管道，下行消息因 `DeliveryNoResolvedTargets` 100% 被静默丢弃！
2. **【严重级】Redis Session Registry 索引脱节**：
   - `apply_session_heartbeat` 未将 `user_id` 和 `room_id` 写入 Redis 集合（`rt:user_sessions:*`、`rt:room:*`），跨节点和按用户/群组寻址完全失效。
   - 硬编码 `3600s` TTL 违反租约安全边界。
3. **【高风险】鉴权强依赖 Node 产生惊群雪崩**：
   - 客户端认证向 Node 发起 2 次串行 HTTP 请求（`/api/auth/me`、`/api/groups/my`），网络抖动万级重连将瞬间击穿 Node 连接池。
   - 需在网关层引入带 TTL（30s）与 Singleflight 机制的内存元数据缓存。
4. **【配置链】2A 到 2B 的环境变量与 Nginx 切流机制**：
   - `deploy/vps/nginx.telegram.conf.example` 与 `deploy/vps/backend.env.example` 需提供灰度分流与秒级回退配置。

---

## 4. 架构设计与改动范围 (Implementation Design)

### 4.1 核心改动文件清册

1. **`telegram-rust-gateway/src/realtime/socket/server.rs`**：
   - 全量修复 10 处 `apply_ingress_envelope`：在 async 函数中补齐 `.await`；在同步/闭包（如 `register_connection` 与 `on_disconnect`）中使用 `tokio::spawn`。
   - 增加认证元数据轻量缓存（对 Node `/api/auth/me` 与 `/api/groups/my` 增加 30s 缓存及 Singleflight 锁收敛）。
2. **`telegram-rust-gateway/src/realtime/state/redis_session_registry.rs`**：
   - 将所有硬编码的 `3600u64` 替换为科学推导的配置项 `lease_ttl_secs`（默认 `100s`）。
   - 在 `apply_session_heartbeat` 与 `apply_ingress_envelope` 中，正确同步 `rt:user_sessions:{user_id}` 与 `rt:room:{room_id}`。
3. **`telegram-rust-gateway/src/config.rs`**：
   - 增加 `realtime_session_lease_ttl_secs`（默认 100）。
   - 完善 `realtime_socket_terminator` 在 `rust` 下的契约校验。
4. **`telegram-rust-gateway/tests/` 目录新增高杠杆测试套件**：
   - 新建 `tests/phase26_socket_terminator_test.rs`，包含三大高价值契约测试：
     1. `test_socket_ingress_event_pipeline_integrity`：验证 Socket 事件确切写入 Registry，杜绝未 await 回归；
     2. `test_delivery_consumer_direct_emit_when_terminator_is_rust`：验证 2B 模式下直接下发，0 drop；
     3. `test_redis_session_lease_ttl_and_indexing`：验证租约 TTL 为 100s 及用户/房间双向索引完整性。
5. **部署与运维证据链**：
   - 更新 `deploy/vps/backend.env.example`（增加 2B 切换说明）；
   - 更新 `deploy/vps/nginx.telegram.conf.example`（增加基于客户端 IP 的 Canary 灰度分流范式与秒级回退说明）；
   - 更新 `docs/architecture/phase-status.md`。

---

## 5. 迁移演进与回退演练 (Rollout & Rollback Playbook)

### 5.1 平滑迁移四阶段
1. **沙箱与单测验证（Stage 0）**：Rust 网关在本地与测试环境跑通全量 TDD 门禁。
2. **Canary 灰度分流（Stage 1）**：
   - 配置 `GATEWAY_REALTIME_SOCKET_TERMINATOR=rust` 启动网关；
   - Nginx 使用 `split_clients` 将 10% 客户端 IP 的 `/socket.io/` 导向 Rust (:4000)，90% 维持 Node (:5000)；
   - 观测下行投递丢包率与 P99 时延。
3. **全量切流与 Node 优雅排空（Stage 2）**：
   - Nginx 灰度提升至 100%；所有新长连接直达 Rust 网关；
   - Node 端保留 15 分钟衰减窗口，待存量连接自然断开或发送重连引导帧。
4. **Node 边缘退役（Stage 3）**：
   - 确认 Node 存量连接降为 0，Node 关闭 `socketService`，完全卸载长连接开销。

### 5.2 秒级分级回退预案
- **L1 快速网络回退（10s）**：Nginx 配置改回 100% 代理至 Node (:5000) 并 `nginx -s reload`。
- **L2 进程级回退（30s）**：将 `GATEWAY_REALTIME_SOCKET_TERMINATOR=node` 重启网关，恢复 2A 代理模式。
