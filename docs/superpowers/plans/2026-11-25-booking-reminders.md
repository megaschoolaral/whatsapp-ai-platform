# Booking Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a tenant that switched it on, every booking the AI makes in the Google Sheet gets two WhatsApp reminders: 10 hours and 1 hour before the appointment.

**Architecture:** When `book_slot` succeeds, a `Booking` row is saved and two delayed BullMQ jobs are added (`reminder` queue, ids `${bookingId}__10h` / `__1h`). The worker re-reads the sheet row, sends only if it still holds this client, and sends through `sendHumanLikeText` (anti-ban aware) like the follow-up sender.

**Tech Stack:** Prisma/Postgres, BullMQ + ioredis, Intl for time zones, vitest, React admin (existing `StepSheets.tsx`).

**Spec:** `docs/superpowers/specs/2026-11-25-booking-reminders-design.md` (builds on `2026-11-24-google-sheets-booking-design.md`)

## Global Constraints

- Reminders are off by default (`remindersEnabled` default `false`) and only for tenants that turned it on; bookings made before that get none.
- Stages: exactly `10h` and `1h` before the appointment; no quiet hours (reminders go out at any hour).
- A stage whose send time is not in the future is not scheduled (booking 6 h ahead: only `1h`; under 1 h ahead: none).
- Time zone is `Tenant.timezone` (default `Asia/Almaty`); no new dependency (use `Intl`).
- Texts: four per tenant (10h/1h × Russian/Kazakh), editable in the admin, empty means the built-in default; `{date}` (dd.mm) and `{time}` (HH:mm) are replaced at send time; at most 500 characters each. Language is stored on the booking.
- A reminder is skipped, with a log line, when: the tenant is not `active`, Sheets or reminders are off, the WhatsApp session is not connected, anti-ban blocks the send, or the sheet row no longer holds this client.
- Every query filters by `tenantId`.
- A failure while saving the booking or scheduling jobs must never turn a written booking into an error reply.

## Review Focus

1. A booking made under 1 hour before the appointment creates no jobs, and one made 6 hours ahead creates only the 1 h job (Task 1, Task 3).
2. The sheet row changed or emptied by a person after the booking: no reminder (Task 4).
3. Reminders switched off after booking: the queued job sends nothing (Task 4).
4. 09:00 in `Asia/Almaty` is 04:00 UTC; the delay is computed from that instant (Task 1).
5. A job for one tenant's booking never reads or messages another tenant's data (Task 3, Task 4).

---

### Task 1: Data model, settings flag, time helpers

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/services/sheets/settings.ts`
- Create: `backend/prisma/migrations/20261125120000_booking_reminders/migration.sql`, `backend/src/services/reminders/time.ts`
- Test: `backend/src/services/reminders/time.test.ts`

**Interfaces:**
- Produces: columns `TenantSheetsSettings.reminder10hRu`, `reminder10hKk`, `reminder1hRu`, `reminder1hKk` (`String?`, null or empty = default).
- Produces: Prisma model `Booking { id String @id @default(uuid()); tenantId String (FK Tenant, onDelete Cascade, @@index([tenantId])); conversationId String; jid String; date String; time String; name String; phone String; lang String; createdAt DateTime @default(now()) }` with relation field `bookings Booking[]` on `Tenant`; column `TenantSheetsSettings.remindersEnabled Boolean @default(false)`.
- Produces: `SheetsSettings.remindersEnabled: boolean` and `reminderTexts: { '10h': { ru: string | null; kk: string | null }; '1h': { ru: string | null; kk: string | null } }` returned by `getSheetsSettings` (`false` and all `null` without a row).
- Produces in `time.ts`: `type ReminderStage = '10h' | '1h'`; `appointmentInstant(date: string, time: string, timeZone: string): Date`; `reminderDelays(startsAt: Date, now: Date): { stage: ReminderStage; delayMs: number }[]`.

- [ ] **Step 1: Write failing tests** in `time.test.ts`:
  - `appointmentInstant('2026-11-25', '09:00', 'Asia/Almaty').toISOString()` is `'2026-11-25T04:00:00.000Z'`; `appointmentInstant('2026-11-25', '09:00', 'UTC')` is `'2026-11-25T09:00:00.000Z'`.
  - `reminderDelays` with `startsAt` 20 h after `now` returns `[{stage:'10h', delayMs: 10*3600e3}, {stage:'1h', delayMs: 19*3600e3}]`; 6 h ahead returns only `{stage:'1h', delayMs: 5*3600e3}`; 30 min ahead returns `[]`; exactly 1 h ahead returns `[]` (Review Focus 1).
- [ ] **Step 2: Run** `npm test --workspace=backend -- reminders/time` → FAIL (module missing).
- [ ] **Step 3: Implement** `time.ts` (offset of the zone at that wall-clock time via `Intl.DateTimeFormat` parts, then subtract it), add the Prisma model, the column, the migration SQL (table, index, FK, `ALTER TABLE "TenantSheetsSettings"` adding `remindersEnabled BOOLEAN NOT NULL DEFAULT false` and the four nullable text columns), and the `remindersEnabled` field in `getSheetsSettings`; run `npx prisma generate`.
- [ ] **Step 4: Run** the new test and `npm test --workspace=backend` → PASS; `npx tsc --noEmit -p backend` → no errors.
- [ ] **Step 5: Commit** `feat(reminders): booking table, reminders flag and time helpers`

### Task 2: Reminder texts (defaults and custom)

**Files:**
- Create: `backend/src/services/reminders/texts.ts`
- Test: `backend/src/services/reminders/texts.test.ts`

**Interfaces:**
- Consumes: `ReminderStage` (Task 1), `Lang` from `services/sheets/language.ts`.
- Produces: `defaultReminderText(stage: ReminderStage, lang: Lang): string` (the four built-in texts, with `{date}` and `{time}` placeholders) and `reminderText(stage: ReminderStage, lang: Lang, b: { date: string; time: string }, custom?: string | null): string` — uses `custom` when it is non-empty after trimming, otherwise the default, then replaces every `{date}` with `dd.mm` and every `{time}` with `HH:mm`.

- [ ] **Step 1: Write failing tests** with `b = { date: '2026-11-26', time: '09:00' }`: `reminderText('10h','ru',b)` equals `Напоминаем: вы записаны на консультацию 26.11 в 09:00. Ждём вас!`; `('1h','ru',b)` equals `Напоминаем: через час, в 09:00, у вас консультация. Ждём вас!`; `('10h','kk',b)` equals `Еске саламыз: сіз 26.11 күні сағат 09:00-ге консультацияға жазылғансыз. Күтеміз!`; `('1h','kk',b)` equals `Еске саламыз: бір сағаттан кейін, сағат 09:00-де, консультацияңыз бар. Күтеміз!`.
- [ ] **Step 2: Run** `npm test --workspace=backend -- reminders/texts` → FAIL.
- [ ] **Step 3: Implement** `reminderText` with the four strings above (date shown as `dd.mm`).
  Also: a custom text `Ждём вас {date} в {time}!` gives `Ждём вас 26.11 в 09:00!`; a custom text with only spaces falls back to the default; a text without placeholders is sent unchanged.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(reminders): default and custom reminder texts in Russian and Kazakh`

### Task 3: Schedule the jobs when a booking is made

**Files:**
- Modify: `backend/src/queues/index.ts`
- Create: `backend/src/services/reminders/schedule.ts`
- Test: `backend/src/services/reminders/schedule.test.ts`

**Interfaces:**
- Consumes: `appointmentInstant`, `reminderDelays` (Task 1), `getSheetsSettings` (`remindersEnabled`), `prisma`.
- Produces in `queues/index.ts`: `reminderJobName = 'reminder'`, `reminderQueue = new Queue('reminder', { connection: redis })`.
- Produces in `schedule.ts`: `scheduleBookingReminders(args: { tenantId: string; conversationId: string; date: string; time: string; name: string; phone: string; lang: Lang }): Promise<void>` — returns without doing anything when `remindersEnabled` is false, when the conversation of this tenant is not found, or when no stage is in the future; otherwise creates the `Booking` (`jid` = the conversation's `contactIdentifier`, verify with `grep -rn upsertConversation backend/src` that callers pass the WhatsApp jid) and adds one job per stage to `reminderQueue` with data `{ bookingId, tenantId, stage }`, `jobId: \`${bookingId}__${stage}\``, `delay: delayMs`, `removeOnComplete: 100`, `removeOnFail: 50`.

- [ ] **Step 1: Write failing tests** (mock `prisma`, `getSheetsSettings`, `reminderQueue.add` with fake timers at a fixed `now`):
  - reminders on, appointment 20 h ahead → `booking.create` called once with the tenant, jid and lang; `add` called twice with ids `<id>__10h` and `<id>__1h` and delays 10 h / 19 h.
  - appointment 6 h ahead → only the `1h` job (Review Focus 1); 30 min ahead → no booking row and no jobs.
  - `remindersEnabled` false → nothing created (Review Focus 3).
  - conversation lookup uses both `id` and `tenantId`; another tenant's conversation id → nothing created (Review Focus 5).
- [ ] **Step 2: Run** `npm test --workspace=backend -- reminders/schedule` → FAIL.
- [ ] **Step 3: Implement** `schedule.ts` and the queue export as specified.
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit -p backend` → no errors.
- [ ] **Step 5: Commit** `feat(reminders): schedule reminder jobs when a booking is made`

### Task 4: Send the reminder (worker)

**Files:**
- Modify: `backend/src/services/sheets/read.ts`, `backend/src/queues/workers.ts`
- Create: `backend/src/services/reminders/send.ts`
- Test: `backend/src/services/sheets/read.test.ts` (extend), `backend/src/services/reminders/send.test.ts`

**Interfaces:**
- Consumes: `reminderText` (Task 2), `getSession` (`services/whatsapp/manager.js`), `sendHumanLikeText` (`services/whatsapp/outbound.js`), `appendMessage`, `emitToTenant` (as in `services/followup/sender.ts`), `getSheetsSettings`, `readSlots`.
- Produces in `read.ts`: `readSlotPeople(tenantId: string, date: string, time: string): Promise<{ name: string; phone: string } | null>` — reads fresh, finds the slot of that date and time, then reads that row's columns B and C (`values.get`, range `${sheetName}!B${row}:C${row}`); `null` when the slot is not found.
- Produces in `send.ts`: `sameClient(booking: { name: string; phone: string }, cell: { name: string; phone: string }): boolean` (true when the last 10 digits of the phones are equal and non-empty, or the names are equal ignoring case and surrounding spaces) and `sendReminder(bookingId: string, tenantId: string, stage: ReminderStage): Promise<void>`.

- [ ] **Step 1: Write failing tests.** `read.test.ts`: `readSlotPeople` returns the row's name and phone and issues the `values.get` for that row; returns `null` for an unknown time. `send.test.ts` (mock prisma, session, `sendHumanLikeText`, `readSlotPeople`, `getSheetsSettings`, `appendMessage`): sends once with `reminderText(stage, booking.lang, booking, <the tenant's custom text for that stage and language>)` and stores an outgoing message with `sentBy: 'system_reminder'` when everything is fine; does not send when (a) the row now holds another name and phone, or is empty (Review Focus 2), (b) reminders are off (Review Focus 3), (c) tenant status is not `active`, (d) there is no connected session, (e) `sendHumanLikeText` returns `{ sent: false }` (no message stored); the booking lookup filters by `tenantId` and a booking of another tenant is never read (Review Focus 5); `sameClient` is true for `+7 702 829 1238` vs `87028291238`.
- [ ] **Step 2: Run** `npm test --workspace=backend -- send read` → FAIL.
- [ ] **Step 3: Implement** `readSlotPeople`, `sameClient`, `sendReminder`; register a `reminder` Worker in `workers.ts` (concurrency 5, same logging style as the follow-up worker, calls `sendReminder(bookingId, tenantId, stage)`).
- [ ] **Step 4: Run** the full suite `npm test --workspace=backend` → PASS; `npx tsc --noEmit -p backend` → no errors.
- [ ] **Step 5: Commit** `feat(reminders): worker sends reminders after re-checking the sheet row`

### Task 5: Hook into booking

**Files:**
- Modify: `backend/src/services/sheets/tool.ts`, `backend/src/services/ai/generate.ts`
- Test: `backend/src/services/sheets/tool.test.ts`, `backend/src/services/ai/generate.sheets.test.ts` (both need `vi.mock('../reminders/schedule.js', ...)`)

**Interfaces:**
- Consumes: `scheduleBookingReminders` (Task 3), `detectLang`.
- Changes: `buildSheetsTool(ctx: { tenantId: string; conversationId?: string | null; lang?: Lang })`. After a `booked` result the tool calls `scheduleBookingReminders({ tenantId, conversationId, date, time, name, phone, lang })` inside `try/catch` (log the error, never change the result), only when `conversationId` is set. `generateReply` computes `lang` before building the tool and passes `conversationId` and `lang`.

- [ ] **Step 1: Write failing tests.** `tool.test.ts`: after a booked call `scheduleBookingReminders` is called once with the tenant, conversation id, date, time, name, phone and lang `'kk'`; it is not called for `taken`, `not_found`, `missing_details`; when it throws, the tool result is still `{ status: 'booked' }` and `state.booked` is true. `generate.sheets.test.ts`: a Kazakh `userMessage` makes the tool pass `lang: 'kk'` to the scheduler.
- [ ] **Step 2: Run** `npm test --workspace=backend -- sheets/tool generate.sheets` → FAIL.
- [ ] **Step 3: Implement** the changes above (move the `lang` computation in `generateReply` ahead of tool creation; keep the existing reply code using the same value).
- [ ] **Step 4: Run** the full suite → PASS; `npx tsc --noEmit -p backend` → no errors.
- [ ] **Step 5: Commit** `feat(reminders): schedule reminders when the AI books a slot`

### Task 6: Admin toggle

**Files:**
- Modify: `backend/src/routes/admin/tenantSheets.ts`, `frontend/src/pages/admin/steps/StepSheets.tsx`
- Test: `backend/src/routes/admin/tenantSheets.test.ts`

**Interfaces:**
- Changes: `GET` view and `PUT` body include `remindersEnabled: boolean` and `reminderTexts` (same shape as in Task 1; `GET` also returns `reminderDefaults` with the same shape holding the built-in texts); the upsert stores them; a field missing from `PUT` keeps the stored value; an empty string clears a text back to the default; a text longer than 500 characters gives a 400 with a clear message.

- [ ] **Step 1: Write failing tests:** `PUT { remindersEnabled: true }` upserts `remindersEnabled: true` and leaves the other fields as stored; `GET` returns `remindersEnabled`, `reminderTexts` and `reminderDefaults`; a `PUT` without the fields keeps the saved values; `PUT` with a custom 10h Russian text stores it, and an empty string stores null; a 501-character text is rejected with 400.
- [ ] **Step 2: Run** `npm test --workspace=backend -- tenantSheets` → FAIL.
- [ ] **Step 3: Implement** the route change and, in `StepSheets.tsx`, a «Клиентке еске салу» block: an on/off button «Қосу» / «Өшіру» (10 сағат және 1 сағат бұрын), the line «AI жазған клиенттерге ғана жіберіледі», four text areas (10 сағат / 1 сағат × Русский / Қазақша) prefilled with the saved text or the default, the hint «{date} — күні, {time} — уақыты», a «Әдепкіге қайтару» button per field, and a «Сақтау» button; it saves through the existing `save` call.
- [ ] **Step 4: Run** the full suite and `npm run build --workspace=frontend` → PASS, builds clean.
- [ ] **Step 5: Commit** `feat(reminders): admin toggle for booking reminders`

### Task 7: Docs and a real check

**Files:**
- Modify: `CLAUDE.md` (add `backend/src/services/reminders/` to "Where things live")

- [ ] **Step 1: Update `CLAUDE.md`** and run `npm test --workspace=backend` and `npm run build` → PASS.
- [ ] **Step 2: Commit** `docs: booking reminders`
- [ ] **Step 3: Check on the real clinic after deploy (needs the user):** switch the toggle on for NG клиник, book a slot a little over one hour ahead, and confirm the 1 h reminder arrives in the client's language; then change that sheet row by hand and book another to confirm no reminder goes out for the changed row. Record the result in the final message.
