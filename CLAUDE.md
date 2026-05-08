# Claude Code conventions for this repo

## Stack
Monorepo (npm workspaces): `backend/` (Node.js + Express + Prisma + Postgres + Redis + BullMQ + Baileys + Vercel AI SDK + Socket.IO) and `frontend/` (Vite + React + Tailwind v4 + ShadCN-style primitives + Zustand + react-router-dom).

## Local dev
1. Postgres + Redis running locally.
2. `cp .env.example .env`, generate secrets:
   - `JWT_SECRET=$(openssl rand -hex 64)`
   - `ENCRYPTION_KEY=$(openssl rand -hex 32)`
3. `npm install`
4. `npm run db:migrate:dev --workspace=backend` (first time)
5. Two terminals: `npm run dev:backend` and `npm run dev:frontend`. Frontend proxies `/api` and `/socket.io` to `:3000`.

## Production / Railway
- Build: `npm install && npm run build`
- Start: `npm start` → runs `prisma migrate deploy && node dist/server.js` from backend.
- Backend serves `frontend/dist` as static.
- Auto-injected: `DATABASE_URL`, `REDIS_URL`, `PORT`. Manual: `JWT_SECRET`, `ENCRYPTION_KEY`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `APP_URL`.
- Healthcheck: `/api/health`.

## Pricing updates
Prompt: "Search the web for current API pricing for GPT-5.1, Gemini 3 Flash, Grok 4.1 Fast, ElevenLabs Scribe v2, and Soniox. Update `backend/src/config/model-pricing.ts` with latest values and bump `lastUpdated`."

## Critical
- `ENCRYPTION_KEY` rotation requires re-encryption migration. Backup outside the repo.
- Per-tenant API keys are AES-256-GCM encrypted in `TenantApiKeys`.
- `geminiKey` is mandatory per tenant (used for File Search RAG).
- Baileys session creds live in `WhatsappSession.encryptedCreds/encryptedKeys` (Postgres, not filesystem).
- All tenant-scoped DB queries must filter by `tenantId`. Use `tenantIsolation` middleware.

## Where things live
- Inbound buffer logic: `backend/src/services/inboundBuffer/`
- AI providers + RAG + vision fallback: `backend/src/services/ai/`
- Baileys: `backend/src/services/whatsapp/`
- Conversation state machine: `backend/src/services/conversations/`
- Onboarding checklist UI: `frontend/src/pages/admin/OnboardingChecklistPage.tsx` and `pages/admin/steps/`.
