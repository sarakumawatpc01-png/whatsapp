# Production Readiness Guide (Single VPS + Docker + Traefik)

This repo is prepared for deployment on a single VPS with Docker Compose where **Traefik** is the only public entrypoint with automatic Let's Encrypt SSL.

## 1) Architecture and routing

Recommended public hostname:
- `whatsapp.agencyfic.com` → frontend and backend routes via Traefik

### Preferred setup
- Use one domain for app + API: frontend on `/`, backend on `/api`, `/socket.io`, and `/health`.
- Keep Postgres and Redis internal-only.

## 2) Traefik mapping

Traefik labels are configured in `docker-compose.prod.yml`:

1. **Frontend router**
   - Host: `whatsapp.agencyfic.com`
   - EntryPoint: `websecure`
   - TLS certresolver: `letsencrypt`
   - Service port: `4173`

2. **Backend router**
   - Host: `whatsapp.agencyfic.com`
   - Paths: `/api`, `/socket.io`, `/health`
   - EntryPoint: `websecure`
   - TLS certresolver: `letsencrypt`
   - Service port: `5000`

## 3) Internal-only endpoints

- `/api/webhooks/*` should be called only by trusted providers.
- Admin and auth endpoints are rate limited and must always require proper auth.
- Do not expose Postgres/Redis ports publicly and do not bind app ports to host.

## 4) Security hardening implemented

- Seed script requires `ALLOW_SEED=true` and refuses to run in production.
- No seed credential logging.
- Strict CORS allowlist via `CORS_ALLOWED_ORIGINS`.
- Global API limiter + auth limiter + OTP limiter + stricter superadmin limiters.
- Request body size limits configured.
- Request validation added for auth/affiliate/superadmin login surfaces.
- Helmet enabled with safe defaults.
- Error responses in production avoid leaking stack traces/internal details.
- Logger applies secret redaction patterns.

## 5) Docker setup summary

- `docker-compose.prod.yml` services:
  - `frontend` (static app via `serve`)
  - `backend` (Node/Express + Prisma)
  - `postgres` (named volume)
  - `redis` (AOF + named volume)
- Restart policy: `unless-stopped`
- Healthchecks: backend, postgres, redis, frontend
- Networks:
  - `internal` for DB/Redis/backend private communication
  - `proxy` as external Traefik network

## 6) Required environment configuration

Use `.env.example` and fill all required values in `.env`.
At minimum set strong values for:
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPERADMIN_JWT_SECRET`
- `POSTGRES_PASSWORD`
- `DATABASE_URL` (or rely on compose-provided override)
- `CORS_ALLOWED_ORIGINS` (production frontend domain only)
- `WA_CONNECT_TOKEN_SECRET` (dedicated short-lived token secret)

### WhatsApp QR/login reliability (required in blocked VPS environments)

- Persist auth state on disk across container restarts:
  - backend uses `WA_SESSION_DIR=/app/whatsapp-auth-state`
  - compose now mounts named volume `whatsapp_auth_state` to `/app/whatsapp-auth-state`
- If WhatsApp blocks your datacenter IP (commonly HTTP 401/403/405), configure residential/mobile egress proxies:
  - `WA_EGRESS_PROXY_URLS=https://user:pass@proxy1:port,https://user:pass@proxy2:port`
  - `WA_EGRESS_PROXY_DEFAULT=https://user:pass@proxy1:port`
- After proxy/env updates, restart backend and reconnect numbers so fresh QR/session initialization occurs.

Frontend `.env` must use production domains:
- `VITE_API_URL=https://whatsapp.agencyfic.com/api`
- `VITE_SOCKET_URL=https://whatsapp.agencyfic.com`

## 7) Websocket requirement

Socket.IO is used; Traefik backend route already includes `/socket.io`.

## 8) Healthcheck endpoint

Backend health endpoint:
- `GET /health`
- Checks both DB and Redis connectivity
- Returns `200` when healthy, `503` when degraded

## 9) Seeding in production

Do **not** run seed in production.
If you ever seed a non-production environment:
- set `ALLOW_SEED=true`
- run `npm run seed`
- unset/disable it afterwards

## 10) Deploy on VPS in 10 steps

1. Install Docker and Docker Compose plugin on Ubuntu 24.04.
2. Clone this repository on VPS.
3. Copy `.env.example` to `.env` and set strong production values.
4. Set frontend env in `frontend/.env` (or build args) to production API/socket URLs.
5. Ensure Traefik is running and attached to external Docker network `proxy`.
6. Build and start stack: `docker compose -f docker-compose.prod.yml up -d --build`.
7. Run Prisma migrations inside backend container (if needed): `npx prisma migrate deploy`.
8. Ensure DNS for `whatsapp.agencyfic.com` points to VPS IP.
9. Verify Traefik detects containers and provisions Let's Encrypt certs.
10. Verify:
   - `https://whatsapp.agencyfic.com` loads UI
   - `https://whatsapp.agencyfic.com/api/...` endpoints return expected responses
   - Auth/login and realtime features work behind SSL.
