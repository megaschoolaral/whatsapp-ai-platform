# Google Sheets Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant can switch Google Sheets booking on or off; when on, the AI manager sees the free slots in the clinic's sheet and books a client into one.

**Architecture:** One platform-wide Google service account reads and writes the sheet the tenant shared. A pure parser turns the sheet rows into slots. Before each reply, free slots go into the system prompt (Redis-cached ~30 s). A `book_slot` tool re-reads the row right before writing; if the slot was taken, nothing is written and the reply text is replaced by our own message. It follows the `send_photos` pattern (`services/photos/tool.ts`), so it works on Gemini (one step) and OpenAI/xAI.

**Tech Stack:** Node/Express, Prisma/Postgres, ioredis, Vercel AI SDK (`ai` v4, `tool()`), zod, vitest, `googleapis` (new), React + Tailwind frontend.

**Spec:** `docs/superpowers/specs/2026-11-24-google-sheets-booking-design.md`

## Global Constraints

- Every tenant-scoped query filters by `tenantId`; the admin routes mount under `/api/admin/tenants/:tenantId/...` with `requireAuth, requireRole('super_admin')`.
- Env var `GOOGLE_SERVICE_ACCOUNT_JSON` is optional in `env.ts` (feature unavailable without it); never log its contents.
- Sheet columns, in order: `Время | ФИ пациента | номер | коммент | записал | источник | услуга | пд` (A to H). A day starts with a title row `пн 02,11` in column A; slot rows follow until the next title row. No year in the sheet.
- A slot is free when `ФИ пациента` (B) and `номер` (C) are both empty. The AI writes B, C, D (only if a comment exists), E = `AI`, F = `WhatsApp`; G and H stay untouched. It never creates rows or times.
- Gemini ends the turn after a tool call, so the AI can't read a tool result and continue; on Google `maxSteps` stays 1 (`generate.ts`).
- Never confirm a booking unless the write succeeded. Settings: `daysAhead` default 7, cache TTL 30 s.
- Followed the existing test style: vitest, `*.test.ts` next to the file.

## Review Focus

1. Title row typed differently (`ПН  02.11`, extra spaces, dot instead of comma) still parses (Task 2).
2. December sheet containing January titles (`пн 05,01`) resolves to next year (Task 2).
3. Slots earlier today are never offered (Task 2).
4. Slot taken between prompt and write: nothing written, our own reply with fresh free slots (Task 4, Task 5).
5. A phone like `+7 707 430 4061` is written as text, not turned into a number or formula (Task 4).

---

### Task 1: Data model, env, Google client

**Files:**
- Modify: `backend/prisma/schema.prisma` (add model, relation on `Tenant`), `backend/src/env.ts`, `backend/package.json`
- Create: `backend/prisma/migrations/20261124120000_sheets_booking/migration.sql` (generate with `npm run db:migrate:dev --workspace=backend -- --name sheets_booking`), `backend/src/services/sheets/client.ts`, `backend/src/services/sheets/settings.ts`
- Test: `backend/src/services/sheets/settings.test.ts`

**Interfaces:**
- Produces: Prisma model `TenantSheetsSettings { tenantId @id, tenant relation (onDelete Cascade), enabled Boolean @default(false), spreadsheetId String?, sheetName String?, daysAhead Int @default(7), updatedAt }`, relation field `sheetsSettings TenantSheetsSettings?` on `Tenant`.
- Produces: `getSheetsClient(): sheets_v4.Sheets | null` (null when env missing or JSON invalid), `getServiceAccountEmail(): string | null`.
- Produces: `parseSpreadsheetId(input: string): string | null` (accepts a full `/spreadsheets/d/<id>/...` URL or a bare id of `[A-Za-z0-9_-]{20,}`), `getSheetsSettings(tenantId: string): Promise<{ enabled: boolean; spreadsheetId: string | null; sheetName: string | null; daysAhead: number }>` (defaults when no row).

- [ ] **Step 1: Write failing tests** in `settings.test.ts`: `parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEf_1234567890abcdefgh/edit#gid=0')` returns `'1AbC-dEf_1234567890abcdefgh'`; a bare id returns itself; `'hello'` and `''` return `null`.
- [ ] **Step 2: Run** `npm test --workspace=backend -- settings` → FAIL (module missing).
- [ ] **Step 3: Add the Prisma model and migration; add `GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional()` to `env.ts`; `npm install googleapis --workspace=backend`; implement `settings.ts` and `client.ts`** (`client.ts` builds `google.auth.JWT`/`GoogleAuth` from the parsed JSON with scope `https://www.googleapis.com/auth/spreadsheets`, memoised).
- [ ] **Step 4: Run** `npm test --workspace=backend -- settings` → PASS; `npx tsc --noEmit -p backend` → no errors.
- [ ] **Step 5: Commit** `feat(sheets): settings model, env var and Google client`

### Task 2: Schedule parser (pure)

**Files:**
- Create: `backend/src/services/sheets/schedule.ts`, `backend/src/services/sheets/types.ts`
- Test: `backend/src/services/sheets/schedule.test.ts`

**Interfaces:**
- Produces in `types.ts`: `interface Slot { date: string /* YYYY-MM-DD */; time: string /* HH:mm */; row: number /* 1-based sheet row */; free: boolean }`.
- Produces in `schedule.ts`: `parseSchedule(values: string[][], today: Date): Slot[]` and `upcomingFreeSlots(slots: Slot[], now: Date, timeZone: string, daysAhead: number): Slot[]`.

- [ ] **Step 1: Write failing tests** using a fixture shaped like the clinic sheet (`[['пн 02,11'], ['Время','ФИ пациента',...], ['12:30','Жансая Марат','87075509253','пакет','Газиза','По рек','повторный','✅'], ['13:00'], ['13:30','Кайраткызы К','+7 707 430 4061'], ['вт 03,11'], ['9:00'], ...]`) with `today = new Date('2026-11-02T09:00:00Z')`. Assert:
  - the header row `Время` is skipped (not a time, not a title);
  - 12:30 and 13:30 have `free: false`, 13:00 has `free: true` with `row: 4`;
  - `'9:00'` normalises to `'09:00'` and belongs to `2026-11-03`;
  - titles `'ПН  02.11'` and `' пн 02,11 '` parse the same date (Review Focus 1);
  - with `today = new Date('2026-12-20T00:00:00Z')`, title `'пн 05,01'` gives `2027-01-05` (Review Focus 2);
  - `upcomingFreeSlots` with `now` = 2026-11-02 13:15 in `Asia/Almaty` drops 13:00 and keeps later free slots, and drops dates beyond `daysAhead` (Review Focus 3).
- [ ] **Step 2: Run** `npm test --workspace=backend -- schedule` → FAIL.
- [ ] **Step 3: Implement.** Title regex on column A: weekday (`пн|вт|ср|чт|пт|сб|вс`, case-insensitive) + day + `[.,]` + month, whitespace-tolerant. Year: of the candidates `today.year-1/0/+1`, take the one that puts the date nearest `today`. Time regex `^\d{1,2}:\d{2}$`, normalised to `HH:mm`. Rows before the first title are ignored. Free = B and C empty after trim.
- [ ] **Step 4: Run** the same test → PASS.
- [ ] **Step 5: Commit** `feat(sheets): parse the clinic schedule into slots`

### Task 3: Read the sheet with a cache

**Files:**
- Create: `backend/src/services/sheets/read.ts`
- Test: `backend/src/services/sheets/read.test.ts`

**Interfaces:**
- Consumes: `getSheetsClient`, `getSheetsSettings` (Task 1), `parseSchedule` (Task 2), `redis` from `src/redis.ts`.
- Produces: `readSlots(tenantId: string, opts?: { fresh?: boolean }): Promise<Slot[]>` (throws on API error; `fresh: true` bypasses the cache), `invalidateSlots(tenantId: string): Promise<void>`.

- [ ] **Step 1: Write failing tests** (mock `getSheetsClient`, `getSheetsSettings` and `redis` get/set/del): two `readSlots` calls within the TTL hit the API once; `fresh: true` hits it again; after `invalidateSlots` the next call hits the API; the cache key contains the `tenantId` (`sheets:values:${tenantId}`), and tenant B never gets tenant A's cached values.
- [ ] **Step 2: Run** `npm test --workspace=backend -- read` → FAIL.
- [ ] **Step 3: Implement.** `spreadsheets.values.get` with range `${sheetName}!A:H`, `valueRenderOption: 'FORMATTED_VALUE'`; cache the raw values (JSON) with `EX 30`, parse on every call.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sheets): read slots with a 30 s Redis cache`

### Task 4: `book_slot` tool and prompt section

**Files:**
- Create: `backend/src/services/sheets/tool.ts`
- Test: `backend/src/services/sheets/tool.test.ts`

**Interfaces:**
- Consumes: `readSlots`, `invalidateSlots` (Task 3), `getSheetsClient`, `getSheetsSettings`.
- Produces: `type BookStatus = 'booked' | 'taken' | 'not_found' | 'error'`.
- Produces: `bookSlot(args: { tenantId: string; date: string; time: string; name: string; phone: string; comment?: string }): Promise<{ status: BookStatus }>` — reads with `fresh: true`, finds the slot by `date`+`time`; none → `not_found`; not free → `taken`; otherwise one `values.batchUpdate` (`valueInputOption: 'RAW'`) writing B:C, D (only if comment), E=`AI`, F=`WhatsApp`, then `invalidateSlots`; any exception → `error`.
- Produces: `buildSheetsTool(ctx: { tenantId: string }): { tool; state: { conflict: boolean; failed: boolean; booked: boolean } }` — tool name key is `book_slot`; parameters zod `{ date: string (YYYY-MM-DD), time: string (HH:mm), name: string, phone: string, comment?: string }`; calls are serialised through a promise chain like `buildPhotoTool`; `taken`/`not_found` set `conflict`, `error` sets `failed`, `booked` sets `booked`.
- Produces: `sheetsPromptSection(slots: Slot[]): string` (free slots grouped by date, Russian like the photo section, rules: offer only listed slots, ask the client's name and phone before calling `book_slot`, call it only after the client picked a time, never claim a booking unless the tool returned `booked`) and `sheetsUnavailablePrompt(): string` (tells the AI not to promise any time) and `conflictReply(freeSlots: Slot[]): string` (Russian: that time is taken, lists up to 5 free slots, or says a manager will contact the client if none).

- [ ] **Step 1: Write failing tests** (mock the Sheets client and `readSlots`):
  - free slot → `booked`, and the `batchUpdate` data contains E=`AI`, F=`WhatsApp`, B=name, C=`'+7 707 430 4061'` with `valueInputOption: 'RAW'` (Review Focus 5); no write to G/H;
  - slot with a name already in B → `taken`, `batchUpdate` never called (Review Focus 4);
  - unknown time → `not_found`; API throws → `error`;
  - two parallel tool calls for the same slot → exactly one `booked`, the other `taken`;
  - `conflictReply` with zero slots contains no slot list and mentions a manager.
- [ ] **Step 2: Run** `npm test --workspace=backend -- sheets/tool` → FAIL.
- [ ] **Step 3: Implement** as specified. Note in a code comment that `записал`/`источник` are dropdowns and the values `AI` and `WhatsApp` must exist in those lists.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sheets): book_slot tool with write-time re-check`

### Task 5: Wire into `generateReply` and the handoff

**Files:**
- Modify: `backend/src/services/ai/generate.ts` (`GenerateReplyResult`, `generateReply`), `backend/src/services/inboundBuffer/flush.ts:149`
- Test: `backend/src/services/ai/generate.sheets.test.ts` (copy the mocking approach of `generate.photos.test.ts`), `backend/src/services/inboundBuffer/flush.test.ts`

**Interfaces:**
- Consumes: Task 4 exports, `getSheetsSettings`, `readSlots`, `upcomingFreeSlots`.
- Produces: `GenerateReplyResult.sheetsBooked: boolean`, `GenerateReplyResult.sheetsFailed: boolean`.

- [ ] **Step 1: Write failing tests** (mock `generateText` and the sheets modules):
  - settings disabled → no `book_slot` tool, prompt has no sheets section, existing photo tests unchanged;
  - enabled → `tools` contains `book_slot`, system prompt contains the free-slot list; with `provider === 'google'` `maxSteps` is 1, otherwise 3;
  - tool state `conflict` → returned `text` equals `conflictReply(...)` built from a fresh `readSlots`, not the model's text (Review Focus 4);
  - `readSlots` throws → no `book_slot` tool, prompt contains `sheetsUnavailablePrompt()`, `sheetsFailed` true;
  - `book_slot` result `error` → `sheetsFailed` true;
  - `flush.test.ts`: `sheetsFailed` → `setStatus(conversationId, 'awaiting_human', { handoffReason: 'sheets_error' })` and no follow-ups scheduled.
- [ ] **Step 2: Run** `npm test --workspace=backend -- generate.sheets flush` → FAIL.
- [ ] **Step 3: Implement.** Register the tool only when `conversationId && textModel.meta.supportsTools` and the settings are enabled. Merge `send_photos` and `book_slot` into one `tools` object; use `maxSteps` = 1 on Google, 3 otherwise, whenever any tool is present. Append the sheets prompt after `photoPrompt`. In `run`, after `generateText`, apply the conflict text replacement. In `flush.ts`, add the `sheetsFailed` branch next to `photoBlocked`.
- [ ] **Step 4: Run** the full backend suite `npm test --workspace=backend` → PASS.
- [ ] **Step 5: Commit** `feat(sheets): AI manager books slots through the sheet`

### Task 6: Admin API

**Files:**
- Create: `backend/src/routes/admin/tenantSheets.ts`
- Modify: `backend/src/server.ts` (import near line 31, mount near line 58 as `/api/admin/tenants/:tenantId/sheets`)
- Test: `backend/src/routes/admin/tenantSheets.test.ts`

**Interfaces:**
- Consumes: `parseSpreadsheetId`, `getServiceAccountEmail`, `getSheetsSettings` (Task 1), `readSlots` (Task 3).
- Produces: `GET /` → `{ enabled, spreadsheetId: string | null, sheetName, daysAhead, serviceAccountEmail }`; `PUT /` body `{ enabled?, spreadsheet?: string (link or id), sheetName?, daysAhead?: int 1..30 }` → same view, 400 `{ error }` when enabling without a valid sheet link/id or tab name, or when the service account env is not set; `POST /check` → `{ ok: true, freeSlots: number, days: number }` or `{ ok: false, error: string }` (never throws, never leaks the key).

- [ ] **Step 1: Write failing tests** (mock prisma and the sheets modules, copy the setup of `photos.test.ts`): PUT with a URL stores only the parsed id; enabling without a sheet name → 400; GET for tenant A never reads tenant B's row; `/check` with a failing `readSlots` returns `ok: false` with a message and status 200.
- [ ] **Step 2: Run** `npm test --workspace=backend -- tenantSheets` → FAIL.
- [ ] **Step 3: Implement** with the same structure as `tenantReceiptCheck.ts` (`upsert` by `tenantId`; 404 when the tenant doesn't exist). After a PUT call `invalidateSlots(tenantId)`.
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit -p backend` → no errors.
- [ ] **Step 5: Commit** `feat(sheets): admin API for sheet settings and connection check`

### Task 7: Onboarding UI

**Files:**
- Create: `frontend/src/pages/admin/steps/StepSheets.tsx`
- Modify: `frontend/src/pages/admin/OnboardingChecklistPage.tsx` (import near line 15; new `Card` after the receipt-check card, ~line 211)

**Interfaces:**
- Consumes: Task 6 endpoints through `apiRequest` from `@/lib/api`.

- [ ] **Step 1: Implement `StepSheets({ tenantId })`** in the style of `StepReceiptCheck.tsx`: link/id input, tab-name input, days-ahead input, the service account email with the line "Кестені осы email-ге Редактор ретінде бөлісіңіз" and a copy button, buttons «Қосу» / «Өшіру» (PUT `enabled`), «Байланысты тексеру» (POST `/check`, toast shows free-slot count or the error). If `serviceAccountEmail` is null, show that the platform key is not configured and disable the buttons. Kazakh UI strings, Russian ones only for the `AI`/`WhatsApp` dropdown hint: «записал» және «источник» бағандарының dropdown тізіміне `AI` және `WhatsApp` қосыңыз.
- [ ] **Step 2: Add the card** «Google Sheets (жазылу)» to `OnboardingChecklistPage.tsx`, shown when `tenantId` is set.
- [ ] **Step 3: Verify** `npm run build --workspace=frontend` → builds without type errors; start `npm run dev:backend` and `npm run dev:frontend`, open the tenant page, confirm the card loads, saves, and the check button reports an error for a bad link.
- [ ] **Step 4: Commit** `feat(sheets): onboarding step to connect Google Sheets`

### Task 8: Docs and real-sheet check

**Files:**
- Modify: `CLAUDE.md` (add `GOOGLE_SERVICE_ACCOUNT_JSON` to the manual Railway variables; add `backend/src/services/sheets/` to "Where things live")

- [ ] **Step 1: Update `CLAUDE.md`.**
- [ ] **Step 2: Manual check with a copy of the clinic sheet.** Create the service account, set the env var locally, share the copy with its email, add `AI` and `WhatsApp` to the dropdown lists of E and F, enable it for a test tenant, then in WhatsApp: ask for a time → the AI offers only free slots; confirm a name and phone → the row's B, C, E, F fill and G, H stay empty; fill the same slot by hand and ask the AI for it → nothing is overwritten and the reply lists other slots. Repeat with a Gemini tenant and an OpenAI tenant. Record the result in the PR description.
- [ ] **Step 3: Run** `npm test --workspace=backend` and `npm run build` → PASS.
- [ ] **Step 4: Commit** `docs: Google Sheets booking setup`
