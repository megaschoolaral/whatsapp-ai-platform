# Google Sheets booking — design

Date: 2026-11-24. Status: waiting for approval.

## Intent and why

A clinic keeps its appointment schedule in a Google Sheet. Each row is a time slot on a working day. A client writes on WhatsApp, the AI manager finds a free slot and books it with the client's name and phone number. Human managers also write into the same sheet by hand, so the AI must never double-book a slot that a person already took.

Each tenant can turn this on or off with one button. Tenants that don't need it are not affected.

## Goals

- Per-tenant switch (on/off) with the sheet link and tab name in the admin onboarding checklist.
- The AI sees free slots before it offers a time, and writes name and phone when the client confirms.
- Works on every text model the platform supports: OpenAI, Gemini, xAI. No model-specific behaviour visible to the tenant.
- No per-tenant secret to store: one platform-wide Google service account; the tenant shares the sheet with its email.

## Non-goals

- Cancelling or rescheduling a booking (later).
- Reminders, calendar sync, payments.
- OAuth with the tenant's own Google account.
- Strict atomic locking against simultaneous human writes (Sheets has no compare-and-set).

## Anti-goals

- The AI says "booked" but the row was not written, or was written over a person's entry.
- Turning the feature on for one tenant changes behaviour for others.
- A tenant reading or writing another tenant's sheet.

## Constraints

- Gemini 3 ends the turn after a tool call (the SDK does not echo `thought_signature`), so on Google `maxSteps` is 1 (`generate.ts`, same limit as `send_photos`). The AI can't read a tool result and continue in the same turn. OpenAI/xAI allow 3 steps.
- All tenant-scoped queries filter by `tenantId` (project rule).
- Railway: the service account JSON is a manual environment variable.
- Sheets API read quota is limited per minute, so reads are cached.

## Approaches considered

1. **Tools only (check + book).** Most flexible. Doesn't work on Gemini without a hand-written step loop. Rejected.
2. **Preload free slots into the prompt + a book tool.** Works everywhere. Weak spot: the slot can be taken between the read and the write.
3. **Option 2 plus a re-check right before writing (chosen).** If the slot was taken, nothing is written and the reply text is replaced by our own message listing fresh free slots. Same idea as `photoBlocked` in the photo tool.

Picked: option 3, because the tenant's model choice is free and must not break booking.

## Design

**Sheet format (from the clinic's real sheet).** One tab holds every day, stacked one under another. Each day starts with a title row such as `пн 02,11` (weekday, day, month; no year, so the year is the current one, and December to January needs care). Under it are that day's slot rows. Columns: `Время | ФИ пациента | номер | коммент | записал | источник | услуга | пд`.
- Slot times are irregular (12:30, 13:00, 14:15, 14:40, ...). Staff create the rows in advance. The AI only fills existing empty rows and never invents a time.
- A slot is free when `ФИ пациента` and `номер` are both empty.
- The AI writes `ФИ пациента`, `номер`, and `коммент` if the client gave one. It sets `записал` to `AI` and `источник` to `WhatsApp`. These two are dropdowns, so both values must be added to the dropdown lists or Sheets may reject the write (the builder checks this). `услуга` and `пд` stay empty for the staff.
- The sheet is parsed top to bottom: a title row sets the current date, the rows below it are that date's slots, until the next title row.

**Data.** New table `TenantSheetsSettings`: `tenantId` (PK, FK), `enabled`, `spreadsheetId`, `sheetName` (the one tab with all days), `daysAhead` (default 7), `updatedAt`. Spreadsheet id is parsed from the link the tenant pastes.

**Service account.** Env `GOOGLE_SERVICE_ACCOUNT_JSON`. The admin step shows the service account's email: "Share the sheet with this email as Editor." A "Check connection" action reads the sheet and reports the number of free slots or the exact error.

**Backend** (`backend/src/services/sheets/`):
- `client.ts` — Google Sheets client (the `googleapis` package, new dependency).
- `slots.ts` — read slots, free-slot filter for the next `daysAhead` days, cached in Redis for about 30 seconds and cleared after a write.
- `tool.ts` — `book_slot(date, time, name, phone, comment?)`. Before writing it re-reads that row (matched by date block and time). Free: writes the cells above, returns success. Taken: writes nothing, marks the turn as blocked.
- Route `backend/src/routes/admin/tenantSheets.ts`: GET and PUT settings, POST check-connection.
- `generate.ts`: when the tenant has it on, add the free-slot list to the system prompt and register the `book_slot` tool. On Google, the tool call ends the turn, so success text comes from the model and the blocked-case text is ours. Add the usage to the existing `maxSteps` logic.

**Frontend.** New `StepSheets.tsx` in `pages/admin/steps/`: toggle, link input, tab name, service account email, "Check connection" button. Same pattern as `StepReceiptCheck.tsx`.

**Errors.** If Sheets is unreachable, the AI gets no slot list and the prompt tells it not to promise a time; the manager is told to call back or a human takes over. The AI never confirms a booking unless the write succeeded.

## Left to the builder

- Parsing robustness: title rows may be merged cells or have small format differences (`пн 02,11`, `пн 02.11`), and times may be typed as text or as time values. Read formatted values and cover the variants with tests using the real sheet's shape.
- Whether to write the year-boundary rule (December sheet that lists January days).
- Time zone handling (use the tenant's zone if one exists, else Asia/Almaty).
- Exact prompt wording for the slot list and the "booking failed" reply, in the tenant's language.
- Tests: slot parsing, the blocked-write path, and `tenantId` isolation.
