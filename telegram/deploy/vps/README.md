# VPS deployment baseline

This directory targets the current `1 vCPU / 2 GB RAM` VPS profile.

## What runs here

- `backend` container for `telegram-clone-backend`
- `redis` container for BullMQ / presence / cache
- host `nginx` as reverse proxy
- managed `MongoDB Atlas` and `Supabase/Postgres` stay external

## Why this shape

- `2 GB RAM` is too small for local Mongo + Postgres + backend + ML together
- backend + redis is realistic on this box
- keeping MongoDB and Postgres managed avoids memory pressure and storage ops

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

## Run backend stack

```bash
cd deploy/vps
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5000/health
```

## Repeatable backend release

On the VPS, keep the real env file outside releases:

```bash
sudo mkdir -p /opt/telegram/shared
sudo cp deploy/vps/backend.env /opt/telegram/shared/backend.env
```

From your local repo, publish a new backend release with:

```bash
REMOTE_ROOT=/opt/telegram RELEASE_ID=$(git rev-parse --short HEAD) ARCHIVE_NAME=telegram-$(git rev-parse --short HEAD).tar.gz \
deploy/vps/release_backend.sh deploy@your-server
```

## Nginx

Render `nginx.telegram.conf.example` with a real domain, copy it to `/etc/nginx/sites-available/telegram.conf`, then enable it:

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
