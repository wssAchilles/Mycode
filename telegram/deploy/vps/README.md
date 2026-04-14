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

## Nginx

Copy `nginx.telegram.conf.example` to `/etc/nginx/sites-available/telegram.conf`, adjust `server_name`, then enable it:

```bash
sudo ln -s /etc/nginx/sites-available/telegram.conf /etc/nginx/sites-enabled/telegram.conf
sudo nginx -t
sudo systemctl reload nginx
```
