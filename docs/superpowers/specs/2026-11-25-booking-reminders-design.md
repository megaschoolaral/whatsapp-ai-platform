# Booking reminders — design

Date: 2026-11-25. Status: waiting for approval. Builds on `2026-11-24-google-sheets-booking-design.md`.

## Intent and why

When the AI books a client into the clinic's Google Sheet, the client gets two WhatsApp reminders: 10 hours and 1 hour before the appointment. Fewer no-shows. It is switched on per tenant (the clinic first), off by default.

## Goals

- A per-tenant switch «Еске салу» in the Google Sheets card, default off, with the reminder texts editable right there.
- For each booking the AI makes: one reminder 10 h before and one 1 h before, in the client's language (Kazakh or Russian, from the chat).
- A reminder never goes out for an appointment that was changed or removed in the sheet.

## Non-goals

- Reminders for rows a person typed into the sheet (the sheet has a phone number, not the WhatsApp chat).
- Cancel/reschedule by replying to a reminder.
- Quiet hours: reminders go out at any time of day (the user chose this).
- Reminders for bookings made before the switch was turned on.

## Anti-goals

- A reminder for a slot that no longer belongs to this client.
- A double reminder after a restart or redeploy.
- Affecting tenants that did not switch it on.

## Constraints

- Jobs run on BullMQ (Redis), like follow-ups (`services/followup/scheduler.ts`), so they survive restarts.
- Times are in the tenant's time zone (`Tenant.timezone`, default `Asia/Almaty`).
- Sends go through the existing outbound path and respect the anti-ban capacity (`getSendCapacity`).
- All queries filter by `tenantId`.

## Approaches

1. **Scan the sheet on a timer** and remind everyone due. Covers manual rows too, but needs a phone to WhatsApp mapping, which is unreliable. Rejected.
2. **Store each AI booking and schedule delayed jobs (chosen).** Exact timing, restart-safe, the chat is known. Covers only AI bookings.

## Design

**Data.** New table `Booking`: `id`, `tenantId`, `conversationId`, `jid`, `date` (YYYY-MM-DD), `time` (HH:mm), `name`, `phone`, `lang` (`kk` | `ru`), `createdAt`. New column `TenantSheetsSettings.remindersEnabled Boolean @default(false)`.

**Creating the booking.** When `book_slot` returns `booked`, and the tenant has reminders on, save the `Booking` and add two delayed jobs `reminder` with ids `${bookingId}__10h` and `${bookingId}__1h`. Delay = appointment time minus 10 h (or 1 h) minus now. A job whose time has already passed is not created (so a booking made 6 h ahead only gets the 1 h reminder; under 1 h ahead gets none).

**Sending.** The worker loads the booking and sends only if all of these hold:
- the tenant still has Sheets and reminders on;
- the sheet row of that date and time, read fresh, still has this client's name or phone (same digits) in `ФИ пациента` / `номер`;
- the WhatsApp session is connected and the anti-ban capacity allows one more message.
Otherwise it skips and logs why. The send is recorded as an outgoing message in the chat.

**Texts.** The admin shows four editable fields, prefilled with the defaults below: 10 h and 1 h, each in Russian and Kazakh (my call: the language follows the chat, so each language needs its own text). `{date}` (dd.mm) and `{time}` (HH:mm) are replaced when the reminder is sent. An empty field means the default is used; a «Әдепкіге қайтару» button clears a field. Each text is at most 500 characters.

**Default texts:**
- 10 h, ru: «Напоминаем: вы записаны на консультацию {dd.mm} в {HH:mm}. Ждём вас!»
- 1 h, ru: «Напоминаем: через час, в {HH:mm}, у вас консультация. Ждём вас!»
- 10 h, kk: «Еске саламыз: сіз {dd.mm} күні сағат {HH:mm}-ге консультацияға жазылғансыз. Күтеміз!»
- 1 h, kk: «Еске саламыз: бір сағаттан кейін, сағат {HH:mm}-де, консультацияңыз бар. Күтеміз!»

**Data for the texts.** Four nullable columns on `TenantSheetsSettings`: `reminder10hRu`, `reminder10hKk`, `reminder1hRu`, `reminder1hKk` (null or empty = default).

**Admin.** `PUT /api/admin/tenants/:tenantId/sheets` accepts `remindersEnabled` and the four texts; `GET` returns them together with the defaults. `StepSheets.tsx` gets the toggle, the four text fields with the hint about `{date}` and `{time}`, and the reset buttons.

## Left to the builder

- The helper that turns a date, time and zone into a UTC instant (no new dependency needed with `Intl`).
- Which existing outbound function to use, as in `services/followup/sender.ts`.
- Tests: delays and skipping past-due jobs, the changed-row skip, restart-safe job ids, tenant isolation, and texts in both languages.
- Checking it on the real clinic: book a slot a little over an hour ahead and wait for the 1 h reminder.
