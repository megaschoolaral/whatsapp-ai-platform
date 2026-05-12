# AI Platform — WhatsApp

Multi-tenant SaaS platform for AI-driven WhatsApp customer support. See `PROJECT.md` for the full spec and `CLAUDE.md` for engineering conventions.

## Quick start (local)

Prerequisites: **Node 20+**, **Postgres** running locally, **Redis** running locally.

```bash
# 1. Configure env
cp .env.example .env
# Edit .env — generate JWT_SECRET, ENCRYPTION_KEY, set SUPER_ADMIN_EMAIL/PASSWORD
#   openssl rand -hex 64   # JWT_SECRET
#   openssl rand -hex 32   # ENCRYPTION_KEY

# 2. Install + migrate
npm install
npm run db:migrate:dev --workspace=backend

# 3. Run (two terminals)
npm run dev:backend    # http://localhost:3000
npm run dev:frontend   # http://localhost:5173 (proxies /api → 3000)
```

Open `http://localhost:5173`, log in as super-admin, create a tenant, walk through the onboarding checklist.

## Deploy to Railway

Railway auto-deploys on every push to `main` once the project is connected. Initial setup is done in the Railway dashboard.

### One-time setup

1. **Create a new Railway project.**
2. **Add a Postgres service** (`+ New → Database → PostgreSQL`). Railway will inject `DATABASE_URL` into your app automatically.
3. **Add a Redis service** (`+ New → Database → Redis`). Railway will inject `REDIS_URL`.
4. **Add your app service** (`+ New → GitHub Repo → your fork`). Railway reads `railway.json` and runs `npm install && npm run build`, then `npm start` (which executes `prisma migrate deploy` before booting the server).
5. **Set environment variables** on the app service (Variables tab):

   | Variable | Value | Notes |
   |---|---|---|
   | `JWT_SECRET` | `openssl rand -hex 64` | 64 hex chars |
   | `ENCRYPTION_KEY` | `openssl rand -hex 32` | EXACTLY 64 hex chars. **Back this up** — losing it bricks every encrypted tenant API key. |
   | `SUPER_ADMIN_EMAIL` | your email | Used to create the first admin |
   | `SUPER_ADMIN_PASSWORD` | strong password, ≥12 chars | Must not be `password` / `admin` / `changeme` / `change_me_immediately` — the bootstrap refuses these. Remove this variable after first login. |
   | `APP_URL` | `https://YOUR-APP.up.railway.app` | **Must match the real domain.** Used for CORS and Socket.IO origin checks in production. Get the domain from Railway's "Settings → Networking → Generate Domain". |
   | `NODE_ENV` | `production` | |

6. **Generate a public domain** (Settings → Networking → Generate Domain), then update `APP_URL` to that domain and redeploy.

7. **Healthcheck:** Railway hits `/api/health` automatically (configured in `railway.json`).

### Subsequent deploys

```bash
git push origin main
```

Railway picks up the push, builds, runs migrations, and redeploys. Watch progress in the Deployments tab.

### First super-admin login

1. Open `https://YOUR-APP.up.railway.app/login`.
2. Log in with `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
3. You'll be forced to change the password on first login (`mustChangePassword=true`).
4. **Remove `SUPER_ADMIN_PASSWORD` from Railway variables.**
5. In the `/admin` panel, create your first tenant and walk through the onboarding checklist (set Gemini API key, choose models, set persona, connect WhatsApp, upload knowledge base).

### Troubleshooting

- **Build fails: `Cannot find module ...`** — Make sure `npm install` ran in the repo root, not inside `backend/` or `frontend/`. Workspaces require root install.
- **App boots but `/api/health` returns 503** — Postgres service not linked. Confirm `DATABASE_URL` is set on the app service (Railway only auto-injects between linked services in the same project).
- **Healthcheck times out** — Check the Deploy logs. Common cause: a worker crashed (e.g. Redis not linked). Confirm `REDIS_URL` is set.
- **First login: "Invalid credentials"** — The bootstrap may have refused the password (placeholder or <12 chars). Check Deploy logs for `[bootstrap]` lines. Set a stronger `SUPER_ADMIN_PASSWORD` and redeploy.
- **Frontend loads but realtime updates don't arrive** — `APP_URL` doesn't match the actual domain, so Socket.IO is rejecting the origin in production. Update `APP_URL` and redeploy.
- **Tenant admin can see another tenant's inbox** — Should be impossible after the cross-tenant socket fix; if you see this, file an issue.

## Architecture summary

- **Backend** (`backend/`): Express + Socket.IO, Baileys WhatsApp sessions per tenant, Vercel AI SDK abstraction (OpenAI / Gemini / Grok), Gemini File Search RAG, ElevenLabs/Soniox STT, BullMQ inbound buffering with adaptive presence-based timing.
- **Frontend** (`frontend/`): React SPA served by Express in production. Two surfaces: `/admin` (super-admin onboarding checklist + cross-tenant usage) and `/app` (tenant inbox + settings).
- **DB**: Postgres (Prisma). All tenant-scoped tables include `tenantId`. API keys AES-256-GCM encrypted.
- **Cache/queues**: Redis (BullMQ for inbound flush jobs and session state).

See `PROJECT.md` for detailed reasoning and `CLAUDE.md` for layout.
