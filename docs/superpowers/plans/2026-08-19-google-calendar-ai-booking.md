# Google Calendar AI-Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI book a 60-minute WhatsApp appointment directly onto the tenant's connected Google Calendar, with the client's name and phone number visible on the event.

**Architecture:** A new `TenantGoogleCalendar` (encrypted refresh token, same AES-GCM pattern as `WhatsappSession`) and `Appointment` Prisma model; a `backend/src/services/calendar/` service layer wrapping the `googleapis` client (OAuth token refresh, freebusy check, event insert); a new `book_appointment` tool wired into the existing `generateText` call in `backend/src/services/ai/generate.ts` via the Vercel AI SDK's multi-step tool-calling; a tenant-admin OAuth connect flow (new `backend/src/routes/tenant/calendar.ts` + `frontend/src/pages/tenant/CalendarPage.tsx`).

**Tech Stack:** TypeScript, Express, Prisma/Postgres, `googleapis` (new dependency), Vercel AI SDK v4 (`ai` package, already present), React + react-router (frontend).

**Spec:** `docs/superpowers/specs/2026-08-19-google-calendar-ai-booking-design.md`

## Global Constraints

- One tenant = one Google Calendar (`calendarId` defaults to `"primary"`). No multi-specialist UI in this plan.
- Every appointment is a fixed 60-minute slot.
- The AI books directly — no human confirmation step.
- Reuse `backend/src/crypto/aesGcm.ts` (`encrypt`/`decrypt`) for the refresh token — do not add a second encryption scheme.
- Reuse the existing `tenantId`-as-PK 1:1 side-table convention (see `WhatsappSession`, `TenantApiKeys` in `backend/prisma/schema.prisma`) for `TenantGoogleCalendar`.
- **No test framework exists in this repo today** (no jest/vitest, no `*.test.ts` files anywhere). Follow that convention: verification in this plan is manual (curl commands with expected output, or a one-off `npx tsx` script), not an automated test suite. Do not introduce a test framework as a side effect of this feature.
- All new backend imports use the `.js` extension on relative paths (ESM/`NodeNext`, matching every existing file in `backend/src`).
- Tenant timezone is `tenant.timezone` (existing field, e.g. `"Asia/Almaty"`) — always pass it to Google Calendar API calls' `timeZone` fields.

---

## Task 1: Google Cloud project + OAuth credentials (manual, blocking)

**Files:** none — this is an interactive setup task done together with the user, not a code change.

This must happen before Task 4 can be verified against a real Google account, but does not block writing/reviewing the code in Tasks 2–8 (they use the credentials only at runtime).

- [ ] **Step 1: Create the Google Cloud project**

Go to https://console.cloud.google.com/projectcreate, create a project (e.g. name it "whatsapp-ai-platform"). Note the project ID.

- [ ] **Step 2: Enable the Calendar API**

In the new project, go to https://console.cloud.google.com/apis/library/calendar-json.googleapis.com and click **Enable**.

- [ ] **Step 3: Configure the OAuth consent screen**

Go to https://console.cloud.google.com/apis/credentials/consent. Choose **External** user type (unless the user has a Google Workspace org, in which case Internal is fine). Fill in app name ("WhatsApp AI Platform"), user support email, developer contact email. Add scope `https://www.googleapis.com/auth/calendar.events` and `.../auth/userinfo.email`. While the app is in "Testing" mode, add the tenant's Google account email under **Test users** (required — otherwise the OAuth flow will reject non-listed accounts).

- [ ] **Step 4: Create OAuth Client ID credentials**

Go to https://console.cloud.google.com/apis/credentials → **Create Credentials → OAuth client ID** → Application type **Web application**. Add an **Authorized redirect URI** for each environment that will use this flow:
- Local: `http://localhost:3000/api/tenant/calendar/callback`
- Railway: `https://app-production-002c.up.railway.app/api/tenant/calendar/callback` (or whatever the current Railway app domain is)

Save. Copy the **Client ID** and **Client secret** — these become `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (wired in Task 3).

---

## Task 2: Prisma schema — `TenantGoogleCalendar` and `Appointment`

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma models `TenantGoogleCalendar`, `Appointment`, enums `GoogleCalendarStatus`, `AppointmentStatus` — consumed by Tasks 5, 6, 7.

- [ ] **Step 1: Add the enums and models**

In `backend/prisma/schema.prisma`, add after the existing `AiUsageCategory` enum (around line 38):

```prisma
enum GoogleCalendarStatus {
  connected
  error
  disconnected
}

enum AppointmentStatus {
  booked
  cancelled
}
```

Add relations to the `Tenant` model (around line 68-74, alongside the other 1:1/1:n relations):

```prisma
  googleCalendar     TenantGoogleCalendar?
  appointments       Appointment[]
```

Add relation to `Conversation` model (around line 161, alongside `messages`):

```prisma
  appointments             Appointment[]
```

Add the two new models at the end of the file (after `AiUsageLog`):

```prisma
model TenantGoogleCalendar {
  tenantId                String               @id
  tenant                  Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  encryptedRefreshToken   String
  googleEmail             String
  calendarId              String               @default("primary")
  status                  GoogleCalendarStatus @default(connected)
  connectedAt             DateTime             @default(now())
  lastErrorAt             DateTime?
  lastErrorMessage        String?
}

model Appointment {
  id             String            @id @default(cuid())
  tenantId       String
  tenant         Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversationId String
  conversation   Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  clientName     String
  clientPhone    String
  startAt        DateTime
  endAt          DateTime
  googleEventId  String
  status         AppointmentStatus @default(booked)
  createdAt      DateTime          @default(now())

  @@index([tenantId, startAt])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:migrate:dev --workspace=backend` — when prompted for a migration name, use `add_google_calendar_appointments`.

Expected: output ends with `Your database is now in sync with your schema.` and a new folder appears under `backend/prisma/migrations/`.

- [ ] **Step 3: Verify Prisma Client picked up the new models**

Run: `grep -c "TenantGoogleCalendar\|Appointment" "backend/node_modules/.prisma/client/index.d.ts"`

Expected: a non-zero number (confirms the generated client includes the new types).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add TenantGoogleCalendar and Appointment models"
```

---

## Task 3: Environment variables for Google OAuth

**Files:**
- Modify: `backend/src/env.ts`
- Modify: `.env.example`
- Modify: `.env` (local, not committed)
- Modify: `README.md`

**Interfaces:**
- Produces: `env.GOOGLE_CLIENT_ID`, `env.GOOGLE_CLIENT_SECRET`, `env.GOOGLE_REDIRECT_URI` (typed strings) — consumed by Task 4's `googleOAuth.ts`.

- [ ] **Step 1: Extend the env schema**

In `backend/src/env.ts`, add to the `schema` object (after `APP_URL`):

```ts
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
```

- [ ] **Step 2: Update `.env.example`**

Append to `.env.example`:

```bash

# --- Google Calendar OAuth (AI-administrator booking feature) ---
# Create credentials at https://console.cloud.google.com/apis/credentials
# Redirect URI must exactly match one registered on the OAuth client.
GOOGLE_CLIENT_ID=REPLACE_WITH_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=REPLACE_WITH_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:3000/api/tenant/calendar/callback
```

- [ ] **Step 3: Fill in the local `.env`**

Using the Client ID/Secret from Task 1 Step 4, add to `/Users/ajbekzaksybaev/platforma whatsapp 2/.env`:

```bash
GOOGLE_CLIENT_ID=<value from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<value from Google Cloud Console>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/tenant/calendar/callback
```

- [ ] **Step 4: Document the Railway variable in README**

In `README.md`, in the Railway env var table (in the "Deploy to Railway" section), add three rows after the existing `APP_URL` row:

```markdown
   | `GOOGLE_CLIENT_ID` | from Google Cloud Console | OAuth client for Calendar booking |
   | `GOOGLE_CLIENT_SECRET` | from Google Cloud Console | keep secret |
   | `GOOGLE_REDIRECT_URI` | `https://YOUR-APP.up.railway.app/api/tenant/calendar/callback` | must match a redirect URI registered on the OAuth client |
```

- [ ] **Step 5: Verify the server still boots with the new required vars**

Run: `cd "backend" && npx tsx -e "import('./src/env.js').then(() => console.log('env OK'))"`

Expected: prints `env OK` (fails loudly with a Zod error listing missing fields if `.env` wasn't filled in correctly in Step 3).

- [ ] **Step 6: Commit**

```bash
git add backend/src/env.ts .env.example README.md
git commit -m "feat(env): add Google OAuth config for calendar booking"
```

(`.env` stays untracked — do not add it.)

---

## Task 4: `googleOAuth.ts` — state signing and consent URL

**Files:**
- Create: `backend/src/services/calendar/googleOAuth.ts`

**Interfaces:**
- Consumes: `env.GOOGLE_CLIENT_ID`, `env.GOOGLE_CLIENT_SECRET`, `env.GOOGLE_REDIRECT_URI` (from `../../env.js`), `env.JWT_SECRET`.
- Produces:
  - `buildOAuth2Client(): OAuth2Client` — plain, uncredentialed client for building URLs / exchanging codes.
  - `signCalendarState(tenantId: string): string` — short-lived signed token carrying the tenant id through the Google redirect.
  - `verifyCalendarState(state: string): string` — returns `tenantId`, throws on invalid/expired state.
  - `buildConsentUrl(tenantId: string): string` — full Google consent screen URL, used by Task 6's `connect-url` endpoint.
  - `exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; googleEmail: string }>` — used by Task 6's `callback` endpoint.

- [ ] **Step 1: Install the `googleapis` and `google-auth-library` dependencies**

Run: `npm install googleapis google-auth-library --workspace=backend`

`google-auth-library` is a transitive dependency of `googleapis`, but this codebase imports its `OAuth2Client` type directly (in this file and in Task 5's `googleCalendar.ts`) — install it explicitly so type resolution doesn't depend on hoisting.

Expected: `package.json` under `backend/` gains `"googleapis"` and `"google-auth-library"` entries in `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Write `googleOAuth.ts`**

Create `backend/src/services/calendar/googleOAuth.ts`:

```ts
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../../env.js';

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const STATE_PURPOSE = 'google_calendar_oauth';

export function buildOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function signCalendarState(tenantId: string): string {
  return jwt.sign({ tenantId, purpose: STATE_PURPOSE }, env.JWT_SECRET, { expiresIn: '10m' });
}

export function verifyCalendarState(state: string): string {
  const payload = jwt.verify(state, env.JWT_SECRET) as { tenantId: string; purpose: string };
  if (payload.purpose !== STATE_PURPOSE) {
    throw new Error('Invalid state purpose');
  }
  return payload.tenantId;
}

export function buildConsentUrl(tenantId: string): string {
  const client = buildOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: CALENDAR_SCOPES,
    state: signCalendarState(tenantId),
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; googleEmail: string }> {
  const client = buildOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token — consent screen may not have used prompt=consent');
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) {
    throw new Error('Google did not return an account email');
  }
  return { refreshToken: tokens.refresh_token, googleEmail: data.email };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd "backend" && npx tsc --noEmit`

Expected: no errors referencing `googleOAuth.ts`.

- [ ] **Step 4: Manual smoke check of state signing (no live Google call needed)**

Run: `cd "backend" && npx tsx -e "
import { signCalendarState, verifyCalendarState } from './src/services/calendar/googleOAuth.js';
const s = signCalendarState('test-tenant-id');
console.log('signed:', s.slice(0, 20) + '...');
console.log('verified tenantId:', verifyCalendarState(s));
"`

Expected: prints `verified tenantId: test-tenant-id`.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json ../package-lock.json backend/src/services/calendar/googleOAuth.ts
git commit -m "feat(calendar): add Google OAuth state signing and consent URL builder"
```

---

## Task 5: `googleCalendar.ts` — authorized client, freebusy, event creation

**Files:**
- Create: `backend/src/services/calendar/googleCalendar.ts`

**Interfaces:**
- Consumes: `TenantGoogleCalendar` Prisma model (Task 2), `decrypt`/`encrypt` from `../../crypto/aesGcm.js`, `prisma` from `../../prisma.js`, `buildOAuth2Client` from `./googleOAuth.js`.
- Produces:
  - `getAuthorizedClient(tenantId: string): Promise<{ client: OAuth2Client; calendarId: string } | null>` — `null` if not connected; marks status `error` and returns `null` on refresh failure. Consumed by Task 7's tool.
  - `checkFreebusy(client: OAuth2Client, calendarId: string, startAt: Date, endAt: Date, timezone: string): Promise<boolean>` — `true` means free. Consumed by Task 7.
  - `createBookingEvent(client: OAuth2Client, calendarId: string, args: { clientName: string; clientPhone: string; startAt: Date; endAt: Date; timezone: string }): Promise<string>` — returns `googleEventId`. Consumed by Task 7.

- [ ] **Step 1: Write `googleCalendar.ts`**

Create `backend/src/services/calendar/googleCalendar.ts`:

```ts
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../prisma.js';
import { decrypt } from '../../crypto/aesGcm.js';
import { buildOAuth2Client } from './googleOAuth.js';
import { logger } from '../../logger.js';

export async function getAuthorizedClient(
  tenantId: string,
): Promise<{ client: OAuth2Client; calendarId: string } | null> {
  const record = await prisma.tenantGoogleCalendar.findUnique({ where: { tenantId } });
  if (!record || record.status !== 'connected') return null;

  const client = buildOAuth2Client();
  client.setCredentials({ refresh_token: decrypt(record.encryptedRefreshToken) });

  try {
    await client.getAccessToken(); // forces a refresh now, surfaces revoked/expired tokens immediately
  } catch (err) {
    logger.error({ err, tenantId }, '[calendar] refresh token invalid, marking connection as error');
    await prisma.tenantGoogleCalendar.update({
      where: { tenantId },
      data: { status: 'error', lastErrorAt: new Date(), lastErrorMessage: (err as Error).message },
    });
    return null;
  }

  return { client, calendarId: record.calendarId };
}

export async function checkFreebusy(
  client: OAuth2Client,
  calendarId: string,
  startAt: Date,
  endAt: Date,
  timezone: string,
): Promise<boolean> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startAt.toISOString(),
      timeMax: endAt.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });
  const busy = res.data.calendars?.[calendarId]?.busy ?? [];
  return busy.length === 0;
}

export async function createBookingEvent(
  client: OAuth2Client,
  calendarId: string,
  args: { clientName: string; clientPhone: string; startAt: Date; endAt: Date; timezone: string },
): Promise<string> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Брон: ${args.clientName} (${args.clientPhone})`,
      description: `Клиент: ${args.clientName}\nТелефон: ${args.clientPhone}\nЗабронировано через WhatsApp AI`,
      start: { dateTime: args.startAt.toISOString(), timeZone: args.timezone },
      end: { dateTime: args.endAt.toISOString(), timeZone: args.timezone },
    },
  });
  if (!res.data.id) throw new Error('Google Calendar did not return an event id');
  return res.data.id;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd "backend" && npx tsc --noEmit`

Expected: no errors referencing `googleCalendar.ts`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/calendar/googleCalendar.ts
git commit -m "feat(calendar): add Google Calendar freebusy check and event creation"
```

---

## Task 6: Tenant calendar routes — status, connect, callback, disconnect, appointments

**Files:**
- Create: `backend/src/routes/tenant/calendar.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `buildConsentUrl`, `verifyCalendarState`, `exchangeCodeForTokens` (Task 4); `encrypt` (`../../crypto/aesGcm.js`); `requireAuth`, `tenantIsolation` (`../../auth/middleware.js`); `prisma`.
- Produces: HTTP endpoints under `/api/tenant/calendar` — `GET /status`, `GET /connect-url`, `GET /callback` (public), `POST /disconnect`, `GET /appointments`. Consumed by Task 8's frontend page.

- [ ] **Step 1: Write the router**

Create `backend/src/routes/tenant/calendar.ts`:

```ts
import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { requireAuth, tenantIsolation } from '../../auth/middleware.js';
import { encrypt } from '../../crypto/aesGcm.js';
import { buildConsentUrl, verifyCalendarState, exchangeCodeForTokens } from '../../services/calendar/googleOAuth.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';

export const tenantCalendarRouter = Router();

// Public: Google redirects the browser here with no Authorization header, so this
// route must sit before the requireAuth middleware below. Tenant identity comes
// from the signed `state` param instead of the JWT.
tenantCalendarRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error || !code || !state) {
    res.redirect(`${env.APP_URL}/app/calendar?calendar_error=denied`);
    return;
  }
  let tenantId: string;
  try {
    tenantId = verifyCalendarState(state);
  } catch {
    res.redirect(`${env.APP_URL}/app/calendar?calendar_error=invalid_state`);
    return;
  }
  try {
    const { refreshToken, googleEmail } = await exchangeCodeForTokens(code);
    await prisma.tenantGoogleCalendar.upsert({
      where: { tenantId },
      create: { tenantId, encryptedRefreshToken: encrypt(refreshToken), googleEmail, status: 'connected' },
      update: { encryptedRefreshToken: encrypt(refreshToken), googleEmail, status: 'connected', lastErrorAt: null, lastErrorMessage: null },
    });
    res.redirect(`${env.APP_URL}/app/calendar?calendar_connected=1`);
  } catch (err) {
    logger.error({ err, tenantId }, '[calendar] OAuth callback failed');
    res.redirect(`${env.APP_URL}/app/calendar?calendar_error=exchange_failed`);
  }
});

tenantCalendarRouter.use(requireAuth, tenantIsolation);

tenantCalendarRouter.get('/status', async (req, res) => {
  const record = await prisma.tenantGoogleCalendar.findUnique({ where: { tenantId: req.tenantScope! } });
  res.json({
    connected: record?.status === 'connected',
    status: record?.status ?? 'disconnected',
    googleEmail: record?.googleEmail ?? null,
    connectedAt: record?.connectedAt ?? null,
    lastErrorMessage: record?.lastErrorMessage ?? null,
  });
});

tenantCalendarRouter.get('/connect-url', async (req, res) => {
  res.json({ url: buildConsentUrl(req.tenantScope!) });
});

tenantCalendarRouter.post('/disconnect', async (req, res) => {
  await prisma.tenantGoogleCalendar.deleteMany({ where: { tenantId: req.tenantScope! } });
  res.json({ ok: true });
});

tenantCalendarRouter.get('/appointments', async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { tenantId: req.tenantScope! },
    orderBy: { startAt: 'desc' },
    take: 50,
  });
  res.json(appointments);
});
```

- [ ] **Step 2: Mount the router in `server.ts`**

In `backend/src/server.ts`, add the import near the other tenant route imports (after line 28's `tenantSettingsRouter` import):

```ts
import { tenantCalendarRouter } from './routes/tenant/calendar.js';
```

Add the mount after line 53 (`app.use('/api/tenant', tenantSettingsRouter);`):

```ts
  app.use('/api/tenant/calendar', tenantCalendarRouter);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd "backend" && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Manual verification against the running dev server**

Run: `npm run dev:backend` (in one terminal, leave running), then in another terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"megaschoolaral@gmail.com","password":"8o2tpUrs7AOPEpEveJTC"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
curl -s http://localhost:3000/api/tenant/calendar/status -H "Authorization: Bearer $TOKEN"
```

Expected: `{"connected":false,"status":"disconnected","googleEmail":null,"connectedAt":null,"lastErrorMessage":null}` (no `TenantGoogleCalendar` row exists yet for this tenant).

Stop the dev server (Ctrl+C) after verifying.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/tenant/calendar.ts backend/src/server.ts
git commit -m "feat(calendar): add tenant OAuth connect/callback/status/appointments routes"
```

---

## Task 7: AI tool — `book_appointment`

**Files:**
- Modify: `backend/src/services/ai/generate.ts`
- Modify: `backend/src/services/inboundBuffer/flush.ts`
- Create: `backend/src/services/ai/tools/bookAppointment.ts`

**Interfaces:**
- Consumes: `getAuthorizedClient`, `checkFreebusy`, `createBookingEvent` (Task 5); `tenant.timezone` from `TenantContext`.
- Produces: `bookAppointmentTool(tenant: TenantContext, conversationId: string, clientPhone: string)` — an AI SDK `tool()` instance, consumed by `generate.ts`'s `generateText` calls.

- [ ] **Step 1: Write the tool factory**

Create `backend/src/services/ai/tools/bookAppointment.ts`:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { prisma } from '../../../prisma.js';
import { getAuthorizedClient, checkFreebusy, createBookingEvent } from '../../calendar/googleCalendar.js';
import type { TenantContext } from '../../tenantContext.js';

const inputSchema = z.object({
  clientName: z.string().describe("The client's name, as given in the conversation"),
  requestedStartAt: z.string().describe('ISO 8601 datetime for the requested appointment start, in the tenant timezone'),
});

export function bookAppointmentTool(tenant: TenantContext, conversationId: string, clientPhone: string) {
  return tool({
    description:
      'Book a 60-minute appointment on the specialist\'s Google Calendar for the given client at the requested time. ' +
      'Call this only after the client has explicitly confirmed a specific date and time. ' +
      'If the tool reports the slot is busy, propose a different time to the client instead of calling it again immediately.',
    parameters: inputSchema,
    execute: async ({ clientName, requestedStartAt }) => {
      const auth = await getAuthorizedClient(tenant.id);
      if (!auth) {
        return { ok: false, reason: 'not_connected' as const };
      }
      const startAt = new Date(requestedStartAt);
      if (Number.isNaN(startAt.getTime())) {
        return { ok: false, reason: 'invalid_time' as const };
      }
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

      const isFree = await checkFreebusy(auth.client, auth.calendarId, startAt, endAt, tenant.timezone);
      if (!isFree) {
        return { ok: false, reason: 'slot_taken' as const };
      }

      const googleEventId = await createBookingEvent(auth.client, auth.calendarId, {
        clientName,
        clientPhone,
        startAt,
        endAt,
        timezone: tenant.timezone,
      });

      await prisma.appointment.create({
        data: { tenantId: tenant.id, conversationId, clientName, clientPhone, startAt, endAt, googleEventId },
      });

      return { ok: true as const, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
    },
  });
}
```

- [ ] **Step 2: Wire the tool into `generate.ts`**

In `backend/src/services/ai/generate.ts`:

Add the import (after line 5):

```ts
import { bookAppointmentTool } from './tools/bookAppointment.js';
```

Extend `GenerateReplyArgs` (after `conversationId?: string | null;` on line 18):

```ts
  clientPhone?: string | null;
```

In `generateReply`, destructure the new arg (line 74):

```ts
  const { tenant, history, userMessage, imageBase64, imageMimeType, conversationId, clientPhone } = args;
```

Build the `tools` object once, right before the two `generateText({ model: textModel.sdkModel, messages })` calls (the vision-passthrough branch around line 96, and the main branch around line 122). Add this just after `const textModel = resolveTextModel(tenant);` (line 81):

```ts
  const tools =
    conversationId && clientPhone
      ? { book_appointment: bookAppointmentTool(tenant, conversationId, clientPhone) }
      : undefined;
```

Update the vision-passthrough `generateText` call (line 96) to pass tools:

```ts
      const result = await generateText({ model: textModel.sdkModel, messages, tools, maxSteps: 4 });
```

Update the main `generateText` call (line 122) the same way:

```ts
  const result = await generateText({ model: textModel.sdkModel, messages, tools, maxSteps: 4 });
```

Update `systemMessage()` (line 28-37) to tell the model about the tool. Add before the closing `return sys;`:

```ts
  sys += `\n\nYou can book appointments directly using the book_appointment tool once the client has confirmed a specific date and time. Every appointment is exactly 60 minutes. If the tool says the slot is taken, suggest a different time instead of retrying the same slot.`;
```

- [ ] **Step 3: Pass `clientPhone` from the inbound pipeline**

In `backend/src/services/inboundBuffer/flush.ts`, update the `generateReply` call (line 64) to include the client's phone number, sourced from the conversation's WhatsApp JID:

```ts
    reply = await generateReply({
      tenant,
      history,
      userMessage: combinedText,
      imageBase64: lastImage?.imageBase64 ?? null,
      imageMimeType: lastImage?.imageMimeType ?? null,
      conversationId,
      clientPhone: conversation.contactIdentifier,
    });
```

- [ ] **Step 4: Verify it compiles**

Run: `cd "backend" && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Manual verification of the not-connected path**

Run: `cd "backend" && npx tsx -e "
import { bookAppointmentTool } from './src/services/ai/tools/bookAppointment.js';
const fakeTenant = { id: 'nonexistent-tenant', timezone: 'Asia/Almaty' } as any;
const t = bookAppointmentTool(fakeTenant, 'fake-conv', '+77001234567');
t.execute({ clientName: 'Тест', requestedStartAt: new Date(Date.now() + 3600_000).toISOString() }, { toolCallId: 'x', messages: [] } as any)
  .then((r: unknown) => console.log('result:', JSON.stringify(r)));
"`

Expected: `result: {"ok":false,"reason":"not_connected"}` (no `TenantGoogleCalendar` row exists for `nonexistent-tenant`, so `getAuthorizedClient` returns `null`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ai/tools/bookAppointment.ts backend/src/services/ai/generate.ts backend/src/services/inboundBuffer/flush.ts
git commit -m "feat(ai): add book_appointment tool to the WhatsApp AI reply flow"
```

---

## Task 8: Frontend — Calendar settings page

**Files:**
- Create: `frontend/src/pages/tenant/CalendarPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiRequest` (`@/lib/api`), `GET /tenant/calendar/status`, `GET /tenant/calendar/connect-url`, `POST /tenant/calendar/disconnect`, `GET /tenant/calendar/appointments` (Task 6).

- [ ] **Step 1: Write the page**

Create `frontend/src/pages/tenant/CalendarPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CalendarStatus {
  connected: boolean;
  status: 'connected' | 'error' | 'disconnected';
  googleEmail: string | null;
  connectedAt: string | null;
  lastErrorMessage: string | null;
}

interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  startAt: string;
  endAt: string;
  status: 'booked' | 'cancelled';
}

export function CalendarPage() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const refresh = async () => {
    const s = await apiRequest<CalendarStatus>('/tenant/calendar/status');
    setStatus(s);
    const appts = await apiRequest<Appointment[]>('/tenant/calendar/appointments');
    setAppointments(appts);
  };

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar_connected')) toast.success('Google Calendar подключён');
    if (params.get('calendar_error')) toast.error('Не удалось подключить Google Calendar');
    if (params.toString()) window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    try {
      const { url } = await apiRequest<{ url: string }>('/tenant/calendar/connect-url');
      window.location.href = url;
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить Google Calendar?')) return;
    await apiRequest('/tenant/calendar/disconnect', { method: 'POST' });
    await refresh();
    toast.success('Отключено');
  };

  const badgeVariant = status?.status === 'connected' ? 'success' : status?.status === 'error' ? 'danger' : 'default';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant={badgeVariant}>{status?.status ?? '—'}</Badge>
            {status?.googleEmail && <span className="text-sm text-slate-500">{status.googleEmail}</span>}
          </div>
          {status?.lastErrorMessage && <div className="text-sm text-red-600">{status.lastErrorMessage}</div>}
          {status?.connected ? (
            <Button onClick={disconnect} variant="outline">
              Отключить
            </Button>
          ) : (
            <Button onClick={connect}>Подключить Google Calendar</Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Последние брони</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Клиент</th>
                <th className="py-2 pr-4">Телефон</th>
                <th className="py-2 pr-4">Время</th>
                <th className="py-2 pr-4">Статус</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{a.clientName}</td>
                  <td className="py-2 pr-4">{a.clientPhone}</td>
                  <td className="py-2 pr-4">{new Date(a.startAt).toLocaleString('ru-RU')}</td>
                  <td className="py-2 pr-4">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {appointments.length === 0 && <div className="text-sm text-slate-400 py-2">Пока нет броней</div>}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the route and nav link**

In `frontend/src/App.tsx`, add the import (alongside the `SimplePages` import block, line 11-18):

```ts
import { CalendarPage } from '@/pages/tenant/CalendarPage';
```

Add to `tenantLinks` (after the `/app/channel` entry, line 39):

```ts
  { to: '/app/calendar', label: 'Календарь' },
```

Add the route (after the `/app/channel` route, line 66):

```tsx
          <Route path="/app/calendar" element={<CalendarPage />} />
```

- [ ] **Step 3: Verify the frontend builds**

Run: `npm run build --workspace=frontend`

Expected: build completes with no TypeScript errors, `frontend/dist/` is produced.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/tenant/CalendarPage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add tenant Calendar settings page"
```

---

## Task 9: End-to-end manual verification + Railway deploy

**Files:** none — verification only.

- [ ] **Step 1: Local end-to-end connect**

Start both dev servers (`npm run dev:backend`, `npm run dev:frontend`), log in as the tenant admin created earlier, open `http://localhost:5173/app/calendar`, click **Подключить Google Calendar**, complete the Google consent screen using the test-user Google account from Task 1 Step 3.

Expected: redirected back to `/app/calendar?calendar_connected=1`, page shows `connected` badge and the Google account email.

- [ ] **Step 2: Local end-to-end booking via WhatsApp**

Using a connected WhatsApp test tenant (per the existing README QR-connect flow), message the bot asking to book an appointment for a specific date/time tomorrow, giving a name.

Expected: the bot confirms the booking in chat; the event appears in the connected Google Calendar with title `Брон: <name> (<phone>)` at the requested time; a row appears in the Calendar page's "Последние брони" table.

- [ ] **Step 3: Verify the conflict path**

Ask the bot to book the same slot again (or a different client asking for the same time).

Expected: the bot replies that the slot is taken and offers an alternative time — no duplicate Calendar event is created.

- [ ] **Step 4: Add Google credentials to the Railway `app` service**

```bash
export PATH="$HOME/.railway/bin:$PATH"
cd "/Users/ajbekzaksybaev/platforma whatsapp 2"
railway variables --service app \
  --set "GOOGLE_CLIENT_ID=<value from Task 1>" \
  --set "GOOGLE_CLIENT_SECRET=<value from Task 1>" \
  --set "GOOGLE_REDIRECT_URI=https://app-production-002c.up.railway.app/api/tenant/calendar/callback" \
  --json
```

Expected: `Set variables GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI`.

- [ ] **Step 5: Deploy and verify on Railway**

```bash
railway up --service app --detach --json
```

Wait for the deploy, then repeat Steps 1-3 against `https://app-production-002c.up.railway.app` instead of localhost.

Expected: same outcomes as the local run — connect flow succeeds, booking creates a real Calendar event, conflicting slot is rejected with an alternative offered.
