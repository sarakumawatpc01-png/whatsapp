# Production Readiness Guide (Single VPS + Docker + Nginx Proxy Manager)

This repo is prepared for deployment on a single VPS with Docker Compose where **Nginx Proxy Manager (NPM)** is the only public entrypoint.

## 1) Architecture and routing

Recommended public hostnames:
- `waizai.<yourdomain>` → frontend container (`frontend:80`)
- `api-waizai.<yourdomain>` (optional) → backend container (`backend:5000`)

### Preferred setup
- Keep backend internal-only if possible.
- If frontend needs direct browser API calls, expose backend via a dedicated API subdomain in NPM.

## 2) NPM mapping

Create Proxy Hosts in NPM:

1. **Frontend host**
   - Domain Names: `waizai.<yourdomain>`
   - Scheme: `http`
   - Forward Hostname / IP: `frontend`
   - Forward Port: `80`
   - Enable `Websockets Support` (safe to keep on)
   - SSL tab: Request new SSL certificate, force SSL, HTTP/2 on

2. **Backend host (only if needed)**
   - Domain Names: `api-waizai.<yourdomain>`
   - Scheme: `http`
   - Forward Hostname / IP: `backend`
   - Forward Port: `5000`
   - Enable `Websockets Support` (required for Socket.IO)
   - SSL tab: Request new SSL certificate, force SSL, HTTP/2 on

## 3) Internal-only endpoints

- `/api/webhooks/*` should be called only by trusted providers.
- Admin and auth endpoints are rate limited and must always require proper auth.
- Do not expose Postgres/Redis ports publicly.

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
  - `frontend` (nginx static)
  - `backend` (Node/Express + Prisma)
  - `postgres` (named volume)
  - `redis` (AOF + named volume)
- Restart policy: `unless-stopped`
- Healthchecks: backend, postgres, redis, frontend
- Networks:
  - `internal` for DB/Redis/backend private communication
  - `proxy` for NPM-facing services

## 6) Required environment configuration

Use `.env.example` and fill all required values in `.env`.
At minimum set strong values for:
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPERADMIN_JWT_SECRET`
- `POSTGRES_PASSWORD`
- `DATABASE_URL` (or rely on compose-provided override)
- `CORS_ALLOWED_ORIGINS` (production frontend domain only)

Frontend `.env` must use production domains:
- `VITE_API_URL=https://api-waizai.<yourdomain>/api` (if backend exposed)
- `VITE_SOCKET_URL=https://api-waizai.<yourdomain>`

## 7) Websocket requirement

Socket.IO is used, so if backend is proxied publicly through NPM, enable **Websockets Support** on that backend proxy host.

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
5. Ensure NPM is running on the same Docker network path for proxying.
6. Build and start stack: `docker compose -f docker-compose.prod.yml up -d --build`.
7. Run Prisma migrations inside backend container (if needed): `npx prisma migrate deploy`.
8. In NPM, create proxy host for `waizai.<yourdomain>` → `frontend:80` and request SSL.
9. If required, create API proxy host for `api-waizai.<yourdomain>` → `backend:5000`, enable websockets, request SSL.
10. Verify:
   - `https://waizai.<yourdomain>` loads UI
   - `https://api-waizai.<yourdomain>/health` returns healthy (if API host enabled)
   - Auth/login and realtime features work behind SSL.
