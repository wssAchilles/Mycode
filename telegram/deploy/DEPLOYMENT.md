# 部署指南

> **重要**：本文档是部署的唯一真相来源。任何对话中涉及部署操作时，必须先读取此文件。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                        用户浏览器                        │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│   Firebase Hosting   │    │    VPS (159.203.142.13)      │
│   telegram-467705    │    │    api.xuziqi.tech           │
│                      │    │                              │
│   前端 SPA           │    │   Nginx → Gateway(:4000)    │
│   (React + Vite)     │    │          → Backend(:5000)   │
│                      │    │          → Socket.IO(:5000)  │
└──────────────────────┘    │                              │
                            │   Docker Compose 服务:       │
                            │   - redis (:6379)            │
                            │   - backend (:5000)          │
                            │   - gateway (:4000)          │
                            │   - delivery_consumer (:4100)│
                            │   - recommendation (:4200)   │
                            │   - graph_kernel (:4300)     │
                            │                              │
                            │   外部依赖:                   │
                            │   - Supabase (PostgreSQL)    │
                            │   - MongoDB Atlas            │
                            │   - Redis (容器内)            │
                            └──────────────────────────────┘
```

---

## 一、前端部署（Firebase Hosting）

### 1.1 平台信息

| 项目 | 值 |
|------|-----|
| 平台 | Firebase Hosting |
| 项目 ID | `telegram-467705` |
| 站点名 | `telegram-467705` |
| URL | 由 Firebase 自动分配（通常是 `telegram-467705.web.app`） |
| 构建目录 | `telegram-clone-frontend/dist` |
| 构建命令 | `npm --prefix telegram-clone-frontend run build` |

### 1.2 自动部署（推荐）

前端通过 GitHub Actions **自动部署**，无需手动操作：

- **触发条件**：push 到 `master` 分支，且 `telegram/` 目录下有文件变更
- **工作流文件**：`.github/workflows/firebase-hosting-merge.yml`
- **部署流程**：
  1. Checkout 代码
  2. `npm ci` 安装依赖
  3. Firebase Extended action 自动构建并部署

```yaml
# 关键配置
on:
  push:
    branches: [master]
    paths: ["telegram/**"]

jobs:
  build_and_deploy:
    steps:
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_TELEGRAM_467705 }}
          channelId: live
          projectId: telegram-467705
          entryPoint: telegram
```

### 1.3 手动部署（紧急情况）

```bash
# 在项目根目录执行
cd telegram/telegram-clone-frontend
npm run build
cd ../..
firebase deploy --only hosting
```

### 1.4 注意事项

- **不要部署到 Vercel**，前端只用 Firebase
- Firebase 配置在 `firebase.json`（项目根目录）
- `.firebaserc` 在 `deploy/firebase/` 目录
- 前端环境变量在 `deploy/vps/frontend.env.production`

---

## 二、后端部署（VPS + Docker Compose）

### 2.1 VPS 信息

| 项目 | 值 |
|------|-----|
| IP | `159.203.142.13` |
| 域名 | `api.xuziqi.tech` |
| SSH | `root@159.203.142.13` |
| 远程目录 | `/opt/telegram` |
| 当前版本链接 | `/opt/telegram/current` → `/opt/telegram/releases/<commit-hash>` |

### 2.2 Docker Compose 服务

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| redis | `redis:7-alpine` | 6379 | 缓存/消息队列 |
| backend | `mycode-telegram-backend` | 5000 | Node.js API 服务 |
| gateway | `mycode-telegram-rust-gateway` | 4000 | Rust 网关 |
| delivery_consumer | `mycode-telegram-go-delivery-consumer` | 4100 | Go 消息投递 |
| recommendation | `mycode-telegram-rust-recommendation` | 4200 | Rust 推荐引擎 |
| graph_kernel | `mycode-telegram-cpp-graph-service` | 4300 | C++ 图计算 |

所有业务镜像来自 GHCR（GitHub Container Registry），tag 为 commit hash 前 7 位。

### 2.3 外部依赖

| 服务 | 连接方式 | 说明 |
|------|----------|------|
| Supabase (PostgreSQL) | `DATABASE_URL` 环境变量 | 主数据库 |
| MongoDB Atlas | `MONGODB_URI` 环境变量 | 文档存储（帖子、UserAction 等） |
| Redis | Docker 容器内 (`redis:6379`) | 缓存、实时消息 |

环境变量存储在 VPS 的 `/opt/telegram/shared/backend.env`。

---

## 三、GHCR 镜像构建

### 3.1 自动构建（推荐）

通过 GitHub Actions **自动构建**，push 到 `master` 即触发：

- **工作流文件**：`.github/workflows/telegram-ghcr-images.yml`
- **触发条件**：push 到 `master`，且以下目录有变更：
  - `telegram/telegram-clone-backend/**`
  - `telegram/telegram-rust-gateway/**`
  - `telegram/telegram-go-delivery-consumer/**`
  - `telegram/telegram-rust-workspace/**`
  - `telegram/telegram-cpp-graph-service/**`
  - `telegram/deploy/vps/**`

```yaml
# 构建流程
jobs:
  rust-workspace-quality:     # 1. Rust 质量门禁（fmt + clippy）
    ...

  build-and-push:             # 2. 并行构建 5 个镜像
    needs: rust-workspace-quality
    strategy:
      matrix:
        include:
          - service_name: backend
            image_name: mycode-telegram-backend
          - service_name: gateway
            image_name: mycode-telegram-rust-gateway
          - service_name: delivery-consumer
            image_name: mycode-telegram-go-delivery-consumer
          - service_name: recommendation
            image_name: mycode-telegram-rust-recommendation
          - service_name: graph-kernel
            image_name: mycode-telegram-cpp-graph-service
```

### 3.2 镜像 Tag 规则

每个镜像推送两个 tag：

```
ghcr.io/wssachilles/<image-name>:<7位commit-hash>
ghcr.io/wssachilles/<image-name>:master-latest
```

**注意**：tag 是 commit hash 的前 **7 位**（不是 8 位）。例如 commit `95fc3cc42e39...` 的 tag 是 `95fc3cc`。

### 3.3 镜像仓库地址

```
ghcr.io/wssachilles/mycode-telegram-backend
ghcr.io/wssachilles/mycode-telegram-rust-gateway
ghcr.io/wssachilles/mycode-telegram-go-delivery-consumer
ghcr.io/wssachilles/mycode-telegram-rust-recommendation
ghcr.io/wssachilles/mycode-telegram-cpp-graph-service
```

### 3.4 手动触发构建

如果需要手动触发（不 push 代码）：

```bash
gh workflow run telegram-ghcr-images.yml --ref master
```

### 3.5 验证镜像是否构建完成

```bash
# 替换 <tag> 为 7 位 commit hash
docker manifest inspect ghcr.io/wssachilles/mycode-telegram-backend:<tag>
docker manifest inspect ghcr.io/wssachilles/mycode-telegram-go-delivery-consumer:<tag>
# ... 其他镜像同理
```

---

## 四、VPS 发布流程

### 4.1 发布脚本

```bash
# 在本地项目根目录执行
bash deploy/vps/release_backend.sh root@159.203.142.13
```

### 4.2 发布脚本做了什么

1. **确定 release tag**：取当前 HEAD 的前 7 位 commit hash
2. **打包部署文件**：`docker-compose.prod.yml` + `nginx.telegram.conf.example` → tar.gz
3. **SCP 到 VPS**：上传到 `/opt/telegram/`
4. **SSH 远程执行**：
   - 解压到 `/opt/telegram/releases/<tag>/`
   - 写入 `.env` 文件（镜像名 + tag）
   - 软链接 `backend.env`（共享环境变量）
   - 切换 `/opt/telegram/current` 指向新 release
   - `docker compose pull` 拉取新镜像
   - `docker compose up -d` 滚动更新
   - `docker image prune -f` 清理旧镜像

### 4.3 发布目录结构

```
/opt/telegram/
├── shared/
│   └── backend.env              # 所有服务共享的环境变量
├── releases/
│   ├── 95fc3cc/                 # 某次 release
│   │   └── deploy/vps/
│   │       ├── docker-compose.prod.yml
│   │       ├── .env             # 镜像名 + tag
│   │       └── backend.env → /opt/telegram/shared/backend.env
│   └── a1b2c3d/                 # 另一次 release
│       └── ...
├── current -> /opt/telegram/releases/95fc3cc/  # 当前活跃版本
└── telegram-95fc3cc.tar.gz     # 临时文件，部署后删除
```

### 4.4 环境变量配置

VPS 上的环境变量在 `/opt/telegram/shared/backend.env`，本地示例在 `deploy/vps/backend.env.example`。

关键变量：

```bash
# 数据库
DATABASE_URL=postgresql://...
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://redis:6379

# 服务端口
BACKEND_PORT=5000
GATEWAY_PORT=4000

# JWT
JWT_SECRET=...

# S3/存储
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=...
```

### 4.5 发布门禁

发布前/发布后可运行 `release_gate.sh` 生成 JSON 报告：

```bash
TAG=$(git rev-parse --short=7 HEAD)
RELEASE_TAG="$TAG" \
RUN_OPS_CHECKS=false \
RELEASE_GATE_REPORT_PATH="/tmp/telegram-pre-release-gate-$TAG.json" \
bash deploy/vps/release_gate.sh root@159.203.142.13
```

门禁默认覆盖：

- **image manifests**：确认 5 个 GHCR 镜像 tag 已存在。
- **remote runtime**：确认 VPS `/opt/telegram/current`、`docker compose ps` 和 gateway 本机 `/health` 可用。
- **ops checks**：依赖 `OPS_METRICS_TOKEN` 和 ops readiness 子脚本；当前标准发布可用 `RUN_OPS_CHECKS=false` 跳过，发布后再用健康端点和容器状态确认。

相关库文件：

- `deploy/vps/lib/env.sh`：release tag 规范化、远端 env 读取。
- `deploy/vps/lib/images.sh`：根据 tag 生成 5 个 GHCR 镜像引用。
- `deploy/vps/lib/remote.sh`：远端 current release、compose 状态、gateway health 检查。

---

## 五、端到端部署流程（标准操作）

### 5.1 完整流程

```bash
# 1. 提交代码
git add .
git commit -m "feat(xxx): 描述"
git push origin master

# 2. 等待 CI 完成（自动）
#    - Firebase Hosting 部署（前端）
#    - GHCR 镜像构建（后端 5 个服务）
#    可在 GitHub Actions 页面查看进度
gh run list --branch master --limit=5
gh run watch <telegram-ghcr-images-run-id> --interval 30 --exit-status

# 3. 验证镜像存在
TAG=$(git rev-parse --short=7 HEAD)
for img in backend rust-gateway go-delivery-consumer rust-recommendation cpp-graph-service; do
  docker manifest inspect "ghcr.io/wssachilles/mycode-telegram-$img:$TAG"
done

# 4. 发布前门禁
RELEASE_TAG="$TAG" RUN_OPS_CHECKS=false \
  RELEASE_GATE_REPORT_PATH="/tmp/telegram-pre-release-gate-$TAG.json" \
  bash deploy/vps/release_gate.sh root@159.203.142.13

# 5. 部署到 VPS
RELEASE_ID="$TAG" RELEASE_TAG="$TAG" CHECK_IMAGE_MANIFESTS=true \
  bash deploy/vps/release_backend.sh root@159.203.142.13

# 6. 验证部署
curl https://api.xuziqi.tech/health
ssh root@159.203.142.13 "readlink /opt/telegram/current"
ssh root@159.203.142.13 "cd /opt/telegram/current/deploy/vps && docker compose -f docker-compose.prod.yml ps"

# 7. 发布后门禁
RELEASE_TAG="$TAG" RUN_OPS_CHECKS=false \
  RELEASE_GATE_REPORT_PATH="/tmp/telegram-post-release-gate-$TAG.json" \
  bash deploy/vps/release_gate.sh root@159.203.142.13
```

### 5.2 仅部署前端

前端在 push 到 master 时自动部署，无需手动操作。如果需要紧急手动部署：

```bash
cd telegram/telegram-clone-frontend && npm run build && cd ../..
firebase deploy --only hosting
```

### 5.3 仅部署后端

```bash
# 确保镜像已构建（CI 完成或手动触发）
bash deploy/vps/release_backend.sh root@159.203.142.13
```

### 5.4 运行 demo 数据

```bash
# 在 VPS 上执行
ssh root@159.203.142.13 "docker exec vps-backend-1 node /app/dist/scripts/demo/prepareInterviewDemo.js --viewer-password <密码>"
```

---

## 六、常见问题排查

### 6.1 GHCR 镜像不存在

**症状**：`release_backend.sh` 报错 `manifest unknown`

**原因**：CI 构建可能还在进行中，或者构建失败

**解决**：
```bash
# 检查 CI 状态
gh run list --workflow=telegram-ghcr-images.yml --limit=3

# 如果构建成功但镜像不存在，检查 tag 是否正确（7 位）
git rev-parse --short=7 HEAD

# 手动触发构建
gh workflow run telegram-ghcr-images.yml --ref master
```

### 6.2 GHCR 构建被瞬时网络问题中断

**症状**：`telegram-ghcr-images.yml` 在 `Set up Docker Buildx` 或 Docker registry 拉取阶段失败，例如：

```text
Client.Timeout exceeded while awaiting headers
```

**原因**：GitHub runner 到 Docker Hub/GHCR 的瞬时网络问题，代码未必有问题。

**解决**：

```bash
gh run rerun <run-id> --failed
gh run watch <run-id> --interval 30 --exit-status
```

如果 rerun 后进入 `rust-workspace-quality` 并通过，再等待 5 个镜像并行 build/push 完成。

### 6.3 发布门禁脚本失败

**症状**：

- `release_gate.sh` 报找不到 `deploy/vps/lib/*.sh`
- `image_manifest_gate.sh` 在 `set -u` 下因为空数组崩溃

**解决**：

确认以下文件存在并已随代码发布：

```bash
ls deploy/vps/lib/env.sh deploy/vps/lib/images.sh deploy/vps/lib/remote.sh
bash -n deploy/vps/release_gate.sh deploy/vps/gates/image_manifest_gate.sh
```

然后重跑：

```bash
TAG=$(git rev-parse --short=7 HEAD)
RELEASE_TAG="$TAG" RUN_OPS_CHECKS=false bash deploy/vps/release_gate.sh root@159.203.142.13
```

### 6.4 VPS 部署后服务不健康

```bash
# SSH 到 VPS 检查容器状态
ssh root@159.203.142.13 "cd /opt/telegram/current/deploy/vps && docker compose ps"

# 查看某个服务的日志
ssh root@159.203.142.13 "docker logs vps-backend-1 --tail 50"
ssh root@159.203.142.13 "docker logs vps-gateway-1 --tail 50"
```

### 6.5 回滚到之前的版本

```bash
# 查看可用的 release
ssh root@159.203.142.13 "ls -1dt /opt/telegram/releases/* | head -5"

# 手动切换（例如回滚到 abc1234）
ssh root@159.203.142.13 "ln -sfn /opt/telegram/releases/abc1234 /opt/telegram/current"
ssh root@159.203.142.13 "cd /opt/telegram/current/deploy/vps && docker compose pull && docker compose up -d"
```

### 6.6 健康检查端点

```bash
# 通过域名
curl https://api.xuziqi.tech/health

# 在 VPS 本机检查各服务
ssh root@159.203.142.13 'for port in 5000 4000 4100 4200 4300; do
  printf "port=%s\n" "$port"
  curl --silent --show-error --max-time 10 "http://127.0.0.1:${port}/health" || true
  printf "\n"
done'
```

注意：公网 IP 直连 `http://159.203.142.13:<port>/health` 可能受 Nginx、防火墙或服务绑定策略影响，返回 empty reply 不一定代表容器异常。生产入口以 `https://api.xuziqi.tech/health` 和 VPS 本机 `127.0.0.1:<port>/health` 为准。

---

## 七、关键文件索引

| 文件 | 说明 |
|------|------|
| `.github/workflows/firebase-hosting-merge.yml` | 前端自动部署工作流 |
| `.github/workflows/telegram-ghcr-images.yml` | 后端镜像自动构建工作流 |
| `deploy/vps/release_backend.sh` | VPS 发布脚本 |
| `deploy/vps/release_gate.sh` | 发布前/后检查脚本 |
| `deploy/vps/gates/image_manifest_gate.sh` | GHCR 镜像 tag 存在性检查 |
| `deploy/vps/gates/remote_runtime_gate.sh` | VPS current release、compose、gateway health 检查 |
| `deploy/vps/lib/env.sh` | release tag 和远端 env 读取工具 |
| `deploy/vps/lib/images.sh` | GHCR 镜像引用生成工具 |
| `deploy/vps/lib/remote.sh` | 远端 runtime 检查工具 |
| `deploy/vps/bootstrap_vps.sh` | VPS 初始化脚本（一次性） |
| `deploy/vps/docker-compose.prod.yml` | 生产环境 Docker Compose |
| `deploy/vps/backend.env.example` | 环境变量示例 |
| `deploy/vps/nginx.telegram.conf.example` | Nginx 配置示例 |
| `deploy/vps/frontend.env.production` | 前端生产环境变量 |
| `deploy/firebase/.firebaserc` | Firebase 项目配置 |
| `firebase.json` | Firebase Hosting 配置（项目根目录） |
| `deploy/DEPLOYMENT.md` | **本文件** |

---

## 八、安全注意事项

- `backend.env` 包含数据库密码和 JWT secret，**不要提交到 git**
- GHCR 镜像使用 `GITHUB_TOKEN` 认证，无需额外配置
- VPS SSH 使用密钥认证
- Firebase 服务账号密钥存储在 GitHub Secrets（`FIREBASE_SERVICE_ACCOUNT_TELEGRAM_467705`）
