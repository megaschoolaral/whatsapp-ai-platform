# AI Platform — WhatsApp

Multi-tenant SaaS platform for AI-driven WhatsApp customer support. See `PROJECT.md` for the full spec and `CLAUDE.md` for engineering conventions.

## Quick start (local)

```bash
# 1. Postgres + Redis running locally
# 2. Configure env
cp .env.example .env
# Edit .env — set JWT_SECRET, ENCRYPTION_KEY, SUPER_ADMIN_EMAIL/PASSWORD

# 3. Install + migrate
npm install
npm run db:migrate:dev --workspace=backend

# 4. Run (two terminals)
npm run dev:backend    # http://localhost:3000
npm run dev:frontend   # http://localhost:5173 (proxies /api → 3000)
```

Open `http://localhost:5173`, login as super-admin, create a tenant, walk through the onboarding checklist.

## Deploy to Railway

1. Create Railway project, add Postgres and Redis services (auto-injects `DATABASE_URL` and `REDIS_URL`).
2. Set env vars in Railway dashboard:
   - `JWT_SECRET` — `openssl rand -hex 64`
   - `ENCRYPTION_KEY` — `openssl rand -hex 32` (back this up — losing it bricks all encrypted API keys)
   - `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (remove `SUPER_ADMIN_PASSWORD` after first login)
   - `APP_URL`
3. Connect the repo. Railway runs `npm install && npm run build`, then `npm start` (which executes `prisma migrate deploy` before booting the server).
4. Healthcheck: `/api/health`.

## Architecture summary

- **Backend** (`backend/`): Express + Socket.IO, Baileys WhatsApp sessions per tenant, Vercel AI SDK abstraction (OpenAI / Gemini / Grok), Gemini File Search RAG, ElevenLabs/Soniox STT, BullMQ inbound buffering with adaptive presence-based timing.
- **Frontend** (`frontend/`): React SPA served by Express in production. Two surfaces: `/admin` (super-admin onboarding checklist + cross-tenant usage) and `/app` (tenant inbox + settings).
- **DB**: Postgres (Prisma). All tenant-scoped tables include `tenantId`. API keys AES-256-GCM encrypted.
- **Cache/queues**: Redis (BullMQ for inbound flush jobs and session state).

See `PROJECT.md` for detailed reasoning and `CLAUDE.md` for layout.
