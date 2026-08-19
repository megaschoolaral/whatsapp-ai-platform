# AI-administrator for service specialists — Google Calendar booking

Date: 2026-08-19
Status: Approved for planning

## Problem

The platform is a multi-tenant WhatsApp AI customer-support SaaS. It needs to
grow from "answers questions" into "AI-administrator for service
specialists": when a client books a time slot over WhatsApp, the specialist's
own Google Calendar must show an event at that time with the client's name
and phone number, so the specialist can see their day at a glance without
opening the app.

## Scope (v1)

- One tenant = one specialist = one Google Calendar. Multi-specialist
  tenants (several calendars per tenant) are an explicit non-goal for v1;
  the data model should not actively block adding it later, but no UI or
  logic for specialist selection is built now.
- Every service/appointment is a fixed **60-minute** slot. No per-service
  duration configuration in v1.
- The AI books appointments **directly and autonomously** during the WhatsApp
  conversation — no human-in-the-loop confirmation step. If the requested
  slot is busy, the AI checks Google Calendar itself and offers the client
  an alternative time in the same conversation turn.
- Cancellation/rescheduling by the client via chat is out of scope for v1
  (can be a fast-follow — the data model supports it via `Appointment.status`
  but no chat flow is built for it now).

## Non-goals

- Multiple specialists/calendars per tenant.
- Per-service duration or service catalog.
- Payment collection at booking time.
- Two-way sync (a specialist manually deleting a Calendar event does not
  currently reconcile back into `Appointment.status` — out of scope for v1).

## Data model changes

Two new Prisma models, following the existing 1:1 side-table convention used
by `WhatsappSession` and `TenantApiKeys` (`tenantId` as PK+FK, encrypted
secret column, `aesGcm.ts` for encryption):

```prisma
enum GoogleCalendarStatus {
  connected
  error
  disconnected
}

model TenantGoogleCalendar {
  tenantId               String   @id
  tenant                 Tenant   @relation(fields: [tenantId], references: [id])
  encryptedRefreshToken   String
  googleEmail             String
  calendarId              String   @default("primary")
  status                  GoogleCalendarStatus @default(connected)
  connectedAt             DateTime @default(now())
  lastErrorAt             DateTime?
  lastErrorMessage        String?
}

enum AppointmentStatus {
  booked
  cancelled
}

model Appointment {
  id             String   @id @default(cuid())
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [id])
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  clientName     String
  clientPhone    String
  startAt        DateTime
  endAt          DateTime
  googleEventId  String
  status         AppointmentStatus @default(booked)
  createdAt      DateTime @default(now())

  @@index([tenantId, startAt])
}
```

`Tenant` gains `googleCalendar TenantGoogleCalendar?` and `appointments
Appointment[]` relations. `Conversation` gains `appointments Appointment[]`.

## Google OAuth connect flow

New backend module `backend/src/services/calendar/googleOAuth.ts` plus routes
in `backend/src/routes/tenant/calendar.ts`, mounted under the existing
tenant_admin-protected router group (same auth pattern as
`tenantKeys.ts`/`tenantPersona.ts`).

1. Tenant admin opens the new **"Календарь"** page
   (`frontend/src/pages/tenant/CalendarPage.tsx`), sees connection status,
   clicks "Google Calendar-ды қосу".
2. `GET /api/tenant/calendar/connect` builds a Google OAuth consent URL
   (scope `https://www.googleapis.com/auth/calendar.events`, `access_type:
   offline`, `prompt: consent` to guarantee a refresh token) and redirects
   the browser.
3. `GET /api/tenant/calendar/callback` exchanges the auth code for tokens,
   fetches the connected Google account email, encrypts the refresh token
   via `aesGcm.ts` (same module used for WhatsApp creds), upserts
   `TenantGoogleCalendar`, redirects back to the Calendar page with a
   success/error flag.
4. `POST /api/tenant/calendar/disconnect` revokes the token (best-effort,
   `https://oauth2.googleapis.com/revoke`) and deletes the
   `TenantGoogleCalendar` row.

New env vars (`backend/src/env.ts`, `.env.example`, README, Railway
Variables): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI` (derived from `APP_URL` +
`/api/tenant/calendar/callback` — can be computed, but explicit env var
avoids mismatches between local/Railway).

**Setup dependency:** a Google Cloud project with OAuth consent screen and
Calendar API enabled must exist before this ships. Creating it is an
interactive step done together with the user (Google login required), not
something the agent can script unattended — called out explicitly as a
pre-implementation task in the plan.

## Google Calendar service layer

`backend/src/services/calendar/googleCalendar.ts`:

- `getAuthorizedClient(tenantId)`: loads `TenantGoogleCalendar`, decrypts the
  refresh token, builds a `google-auth-library` OAuth2 client, refreshes the
  access token. On refresh failure, sets `status: error` +
  `lastErrorMessage` and throws — callers treat this as "calendar
  unavailable, tell the client to contact the specialist directly."
- `checkFreebusy(tenantId, startAt, endAt)`: calls the Calendar Freebusy API
  for the tenant's `calendarId`, returns `boolean` free/busy.
- `createBookingEvent(tenantId, { clientName, clientPhone, startAt, endAt })`:
  inserts a Calendar event (`summary: "Брон: {clientName} ({clientPhone})"`,
  `description` includes the phone number again for search/visibility),
  returns the created `googleEventId`.

All calendar timestamps use `tenant.timezone` (existing field, already
defaulted to `Asia/Almaty`).

## AI tool-calling integration

`backend/src/services/ai/generate.ts` currently calls `generateText({
model, messages })` with no `tools`. Add a `book_appointment` tool
(Vercel AI SDK `tool()` helper, Zod input schema: `clientName`,
`requestedStartAt` ISO string, `requestedDurationMinutes` fixed to 60) which:

1. Skips (returns "calendar not connected") if the tenant has no
   `TenantGoogleCalendar` with `status: connected` — the AI then falls back
   to today's manual behavior (tell the client someone will confirm).
2. Calls `checkFreebusy`. If busy, returns a structured "slot taken" result
   so the model can propose an alternative in its next step (AI SDK's
   multi-step `generateText` tool loop — `maxSteps` needs raising from
   implicit 1 to allow a follow-up text turn after the tool call).
3. If free, calls `createBookingEvent`, persists an `Appointment` row
   (`conversationId` from the active conversation, `clientPhone` from the
   WhatsApp JID already available in the inbound pipeline), returns success.

The client's phone number is derived from the conversation's
`contactIdentifier` (already tracked) — the AI does not need to ask for it
unless the WhatsApp number differs from the person booking (acceptable v1
limitation, not handled).

## Frontend

- `frontend/src/pages/tenant/CalendarPage.tsx`: connection card (status,
  connected Google email, "Ажырату" button, or "Қосу" button if
  disconnected), plus a simple table of recent `Appointment` rows (name,
  phone, time, status) fetched from a new `GET
  /api/tenant/calendar/appointments` endpoint.
- New route `/app/calendar` in `frontend/src/App.tsx`'s tenant_admin block,
  new nav entry in `tenantLinks`.

## Error handling

- OAuth callback failures (denied consent, expired code): redirect to
  Calendar page with an error banner, no partial `TenantGoogleCalendar` row
  written.
- Refresh token revoked/expired at call time: caught in
  `getAuthorizedClient`, tenant status flips to `error`, admin sees a
  reconnect prompt on the Calendar page; AI tool treats it the same as
  "not connected."
- Freebusy/insert API errors (network, quota): tool returns a generic
  failure to the model, which falls back to "маман өзі хабарласады" style
  response — no unhandled exception should reach the WhatsApp reply path.

## Testing

- Unit tests for `googleCalendar.ts` against mocked `googleapis` client
  (freebusy true/false, insert success/failure, token refresh failure).
- Unit test for the `book_appointment` tool covering: not-connected,
  busy-slot, successful-booking paths, asserting the `Appointment` row and
  the structured tool result shape.
- Manual end-to-end check (documented in the plan, not automatable without
  live Google creds): connect a real Google account, book via a WhatsApp
  test conversation, confirm the event appears in Google Calendar with the
  right name/phone/time.
