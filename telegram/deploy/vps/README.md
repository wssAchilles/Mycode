# VPS deployment baseline

This directory targets the current `1 vCPU / 2 GB RAM` VPS profile.

## What runs here

- `gateway` container for `telegram-rust-gateway`
- `backend` container for `telegram-clone-backend`
- `redis` container for BullMQ / presence / cache
- host `nginx` as reverse proxy
- managed `MongoDB Atlas` and `Supabase/Postgres` stay external

## Why this shape

- `2 GB RAM` is too small for local Mongo + Postgres + backend + ML together
- gateway + backend + redis is realistic on this box
- keeping MongoDB and Postgres managed avoids memory pressure and storage ops
- Socket.IO keeps a direct Node compatibility path in nginx while HTTP ingress moves to Rust

## First-time bootstrap

```bash
sudo bash deploy/vps/bootstrap_vps.sh
```

## Prepare env file

```bash
cd deploy/vps
cp backend.env.example backend.env
```

Fill at least:

- `MONGODB_URI`
- `DATABASE_URL`
- `JWT_SECRET`
- `GEMINI_API_KEY`
- `FRONTEND_ORIGIN`
- `OPS_METRICS_TOKEN`

## Run backend stack locally on the VPS

```bash
cd deploy/vps
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:4000/health
```

`docker-compose.yml` is the local build-first profile. It is useful for smoke testing on a stronger box, but it is not the recommended production path for this VPS.

## Production release via GHCR

The production path is:

1. GitHub Actions builds `telegram-clone-backend` and `telegram-rust-gateway`
2. Images are pushed to GHCR
3. The VPS only runs `docker compose pull && docker compose up -d`

The production compose file is `docker-compose.prod.yml`.

### One-time GHCR login on the VPS

If the GHCR packages are private, log in once on the VPS:

```bash
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin
```

If you make the packages public, the login step is not required.

### Repeatable backend release

On the VPS, keep the real env file outside releases:

```bash
sudo mkdir -p /opt/telegram/shared
sudo cp deploy/vps/backend.env /opt/telegram/shared/backend.env
```

From your local repo, publish a new backend release with the image tag that GitHub Actions built:

```bash
REMOTE_ROOT=/opt/telegram RELEASE_ID=$(git rev-parse --short HEAD) \
deploy/vps/release_backend.sh deploy@your-server
```

If GHCR is private, pass credentials from your local shell when you run the release:

```bash
GHCR_USERNAME=your-github-user GHCR_TOKEN=ghp_xxx \
REMOTE_ROOT=/opt/telegram RELEASE_ID=$(git rev-parse --short HEAD) \
deploy/vps/release_backend.sh deploy@your-server
```

## Gateway ops surface

The Rust gateway now exposes a small ops surface behind the same `OPS_METRICS_TOKEN` or `GATEWAY_OPS_TOKEN`:

- `GET /health`
- `GET /gateway/ops/control-plane`
- `GET /gateway/ops/control-plane/summary`
- `GET /gateway/ops/ingress-policy`
- `GET /gateway/ops/traffic`

Example:

```bash
curl -H "Authorization: Bearer ${OPS_METRICS_TOKEN}" \
  https://api.example.com/gateway/ops/ingress-policy
```

The gateway also preserves or generates `X-Request-Id` on every proxied request and forwards `X-Chat-Trace-Id` when the client sends it. That makes the Rust ingress, Node backend, and frontend runtime easier to correlate during incident review.

`/gateway/ops/traffic` returns typed ingress events plus per-route-class aggregates, so operators can inspect rate-limit hits, unauthorized rejects, and upstream failures without scraping raw logs.

## Nginx

Render `nginx.telegram.conf.example` with a real domain, copy it to `/etc/nginx/sites-available/telegram.conf`, then enable it. `/socket.io/` keeps proxying to the Node backend in compat mode; all other traffic enters the Rust gateway:

```bash
export API_DOMAIN=api.example.com
envsubst '${API_DOMAIN}' < deploy/vps/nginx.telegram.conf.example | sudo tee /etc/nginx/sites-available/telegram.conf >/dev/null
sudo ln -s /etc/nginx/sites-available/telegram.conf /etc/nginx/sites-enabled/telegram.conf
sudo nginx -t
sudo systemctl reload nginx
```

## TLS

Once `${API_DOMAIN}` resolves to the VPS IP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "${API_DOMAIN}" --redirect
```

## Repeatable Firebase release

```bash
cp deploy/firebase/frontend.env.production.example deploy/firebase/frontend.env.production
# edit deploy/firebase/frontend.env.production with the real API domain
deploy/firebase/release_frontend.sh
```
