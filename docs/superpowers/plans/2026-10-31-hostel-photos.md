# Hostel Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant admins upload photos into 8 fixed categories; when a client asks, the AI sends that category's photos into the WhatsApp chat.

**Architecture:** Photos live in Postgres (`PropertyPhoto`, compressed with the existing `compressImage`). `generateReply` gets an optional `send_photos` AI-SDK tool that only *decides and queues* categories; `flushBuffer` sends the reply text first, then the queued photos with anti-ban pacing, and records `PhotoSend` rows so a category is not re-sent in the same conversation.

**Tech Stack:** Express + Prisma + Postgres, Vercel AI SDK v4 (`ai@^4`, `tool()`, `maxSteps`), Baileys, multer, sharp, vitest; frontend React + Tailwind + `apiRequest`.

**Spec:** `docs/superpowers/specs/2026-10-31-hostel-photos-design.md`

## Global Constraints

- Category ids (stable keys): `kitchen`, `bathroom`, `lounge`, `room_2`, `room_4`, `room_6`, `room_8`, `room_10`. Labels (RU): Кухня, Ванная, Зона отдыха, 2-местный номер, 4-местный номер, 6-местный номер, 8-местный номер, 10-местный номер.
- Max **10 photos per category**; max **2 categories per AI reply** (≤ 20 photos).
- Every DB query filters by `tenantId`; routes use `requireAuth, tenantIsolation` (CLAUDE.md).
- Railway has no persistent filesystem: photos stored as `Bytes` in Postgres.
- Photos are visible to **every tenant** (no flag, no tenant type).
- Repeat request for an already-sent category in the same conversation → AI answers in text that photos were sent above; a different category is sent.
- If remaining anti-ban capacity cannot fit the whole category: send nothing, do not record as sent, AI says photos will follow, conversation → `awaiting_human`.
- No non-AI keyword fallback. Tool is registered only when the tenant has ≥ 1 photo and the text model has `supportsTools: true`.
- Reply text is sent first, then photos. Admin changing a category's photos (upload/delete) resets the "already sent" records for that category (that tenant).
- Existing system-prompt rule "Never ask the client questions" stays, **except** one clarifying question about which photo category when the category is unclear.
- Work on branch `no-calendar`; commit author per repo history; commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Corrupt or non-image upload → 400, nothing stored (Task 2).
2. 11th photo in a category, including two concurrent uploads racing for the last slot → rejected, count stays ≤ 10 (Task 2).
3. Another tenant's photo id on delete/image-fetch → 404, nothing deleted (Task 3).
4. Model calls the tool with a category not in the list, or a third category in one reply → rejected without crash, no extra send (Task 4).
5. Photo send fails or capacity runs out midway → category is not recorded as sent, conversation goes to `awaiting_human`, text reply is not lost (Task 6).

## File Structure

- Create `backend/src/services/photos/categories.ts` — category list, limits, type guard.
- Create `backend/src/services/photos/store.ts` — photo CRUD + sent-record queries.
- Create `backend/src/services/photos/tool.ts` — AI tool + request decision logic.
- Create `backend/src/services/photos/send.ts` — sends queued categories to WhatsApp.
- Create `backend/src/routes/tenant/photos.ts` — tenant API.
- Create `frontend/src/pages/tenant/PhotosPage.tsx` — cabinet page.
- Modify `backend/prisma/schema.prisma` (+ migration), `backend/src/server.ts`, `backend/src/config/model-pricing.ts`, `backend/src/services/ai/generate.ts`, `backend/src/services/whatsapp/antiBan.ts`, `backend/src/services/whatsapp/outbound.ts`, `backend/src/services/inboundBuffer/flush.ts`, `frontend/src/App.tsx`, `frontend/src/lib/api.ts`.
- Tests next to sources (`*.test.ts`, vitest, mock `../../prisma.js` as in `services/whatsapp/sessionStore.test.ts`).

---

### Task 1: Data model and categories

**Files:**
- Modify: `backend/prisma/schema.prisma` (add models, back-relations on `Tenant` and `Conversation`)
- Create: migration via `npm run db:migrate:dev --workspace=backend -- --name property_photos`
- Create: `backend/src/services/photos/categories.ts`
- Test: `backend/src/services/photos/categories.test.ts`

**Interfaces:**
- Produces:
  - `export const PHOTO_CATEGORIES: readonly { id: PhotoCategoryId; label: string }[]` (8 entries, order as in Global Constraints)
  - `export type PhotoCategoryId = 'kitchen' | 'bathroom' | 'lounge' | 'room_2' | 'room_4' | 'room_6' | 'room_8' | 'room_10'`
  - `export const MAX_PHOTOS_PER_CATEGORY = 10`, `export const MAX_CATEGORIES_PER_REPLY = 2`
  - `export function isPhotoCategory(v: string): v is PhotoCategoryId`
  - Prisma models `PropertyPhoto { id, tenantId, category String, mimeType String, data Bytes, sizeBytes Int, createdAt; @@index([tenantId, category, createdAt]) }` and `PhotoSend { id, tenantId, conversationId, category String, sentAt; @@unique([conversationId, category]); @@index([tenantId, category]) }` (both cascade-delete with Tenant / Conversation).

- [ ] **Step 1: Write failing test** `categories.test.ts`: `PHOTO_CATEGORIES` has 8 unique ids; `isPhotoCategory('room_4')` is true, `isPhotoCategory('room_3')` and `isPhotoCategory('')` are false.
- [ ] **Step 2: Run** `npm test --workspace=backend -- categories` → FAIL (module missing).
- [ ] **Step 3: Implement** `categories.ts` and add the Prisma models; run the migrate command and `npm run db:generate --workspace=backend`.
- [ ] **Step 4: Run** the test → PASS; `npx tsc --noEmit` in `backend/` → no errors.
- [ ] **Step 5: Commit** `feat(photos): data model and fixed categories`.

### Task 2: Photo store

**Files:**
- Create: `backend/src/services/photos/store.ts`
- Test: `backend/src/services/photos/store.test.ts`

**Interfaces:**
- Consumes: Task 1 constants/models; `compressImage(buf: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }>` from `services/whatsapp/media.ts`.
- Produces:
  - `export class PhotoLimitError extends Error`, `export class InvalidImageError extends Error`
  - `addPhoto(tenantId: string, category: PhotoCategoryId, buf: Buffer, mimeType: string): Promise<{ id: string }>` — rejects non-`image/*` mime or undecodable buffer with `InvalidImageError`; compresses; inserts inside a transaction that re-counts the category (so concurrent uploads cannot exceed 10) and throws `PhotoLimitError` at 10; then deletes `PhotoSend` rows for `(tenantId, category)`.
  - `deletePhoto(tenantId: string, id: string): Promise<boolean>` — false if not found for that tenant; on success also resets `PhotoSend` for that category.
  - `listPhotoSummary(tenantId: string): Promise<{ id: PhotoCategoryId; label: string; photos: { id: string; sizeBytes: number }[] }[]>` (all 8 categories, oldest photo first)
  - `getPhotoData(tenantId: string, id: string): Promise<{ data: Buffer; mimeType: string } | null>`
  - `getCategoryPhotos(tenantId: string, category: PhotoCategoryId): Promise<{ id: string; data: Buffer; mimeType: string }[]>`
  - `tenantHasPhotos(tenantId: string): Promise<boolean>`
  - `wasCategorySent(conversationId: string, category: PhotoCategoryId): Promise<boolean>`, `recordCategorySent(tenantId: string, conversationId: string, category: PhotoCategoryId): Promise<void>` (idempotent upsert)

- [ ] **Step 1: Write failing tests** (mock `prisma` incl. `$transaction`, mock `compressImage`): `addPhoto` throws `InvalidImageError` for `application/pdf`; throws `PhotoLimitError` when the in-transaction count is 10 and inserts nothing; success resets `photoSend.deleteMany({ where: { tenantId, category } })`; `deletePhoto('t1', idOfOtherTenant)` returns false and calls no delete.
- [ ] **Step 2: Run** `npm test --workspace=backend -- photos/store` → FAIL.
- [ ] **Step 3: Implement** `store.ts` to the signatures above (Prisma `$transaction` with count-then-create; a decode failure from `compressImage` maps to `InvalidImageError`).
- [ ] **Step 4: Run** tests → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(photos): photo store with per-category limit`.

### Task 3: Tenant API

**Files:**
- Create: `backend/src/routes/tenant/photos.ts`; Modify `backend/src/server.ts` (register `app.use('/api/tenant', tenantPhotosRouter)` next to the other tenant routers)
- Test: `backend/src/routes/tenant/photos.test.ts`

**Interfaces:**
- Consumes: Task 2 store functions.
- Produces (all under `/api/tenant`, `requireAuth, tenantIsolation`, tenant = `req.tenantScope!`):
  - `GET /photos` → `{ categories: ReturnType<typeof listPhotoSummary> }`
  - `POST /photos/:category` (multer memory storage, field `file`, 10 MB limit) → 201 `{ id }`; 400 on unknown category / `InvalidImageError` / missing file; 409 on `PhotoLimitError`
  - `DELETE /photos/:id` → 204, 404 if `deletePhoto` returns false
  - `GET /photos/:id/image` → raw bytes with the stored `Content-Type`, 404 if missing for that tenant

- [ ] **Step 1: Write failing tests** (supertest if already present in `backend/package.json`; otherwise call the exported handler functions directly with mocked `req/res`, same mocking style as the store test): unknown category → 400; `PhotoLimitError` → 409; delete of an id the store reports false → 404.
- [ ] **Step 2: Run** the tests → FAIL.
- [ ] **Step 3: Implement** the router and register it in `server.ts`.
- [ ] **Step 4: Run** tests → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(photos): tenant photos API`.

### Task 4: AI tool and request decision

**Files:**
- Create: `backend/src/services/photos/tool.ts`
- Modify: `backend/src/config/model-pricing.ts` (add `supportsTools: boolean` to the text/vision model interface; set `true` for every existing model after Step 5's manual check)
- Modify: `backend/src/services/whatsapp/antiBan.ts` — add `getSendCapacity(tenantId: string): Promise<{ remaining: number }>` (min of remaining hourly-hard and daily-hard; does not increment counters; `remaining: 0` when no session)
- Test: `backend/src/services/photos/tool.test.ts`

**Interfaces:**
- Consumes: `isPhotoCategory`, `MAX_CATEGORIES_PER_REPLY`, `MAX_PHOTOS_PER_CATEGORY`; store `wasCategorySent`, `getCategoryPhotos` count; `getSendCapacity`.
- Produces:
  - `export type PhotoToolStatus = 'queued' | 'already_sent' | 'no_photos' | 'blocked' | 'limit_reached' | 'invalid_category'`
  - `export async function decidePhotoRequest(args: { tenantId: string; conversationId: string; category: string; alreadyQueued: PhotoCategoryId[] }): Promise<{ status: PhotoToolStatus }>` — order of checks: valid category → not already queued in this reply → fewer than `MAX_CATEGORIES_PER_REPLY` queued → `wasCategorySent` → photo count > 0 → capacity ≥ photo count (+ photos already queued in this reply).
  - `export function buildPhotoTool(ctx: { tenantId: string; conversationId: string }): { tool: ReturnType<typeof tool>; queued: PhotoCategoryId[] }` — AI-SDK `tool({ description, parameters: z.object({ category: z.string() }), execute })`; `execute` calls `decidePhotoRequest`, pushes onto `queued` only when `status === 'queued'`, returns `{ status }`. (`category` is a plain string validated by `decidePhotoRequest`, so an invalid value from the model returns `invalid_category` instead of throwing.)
  - `export function photoPromptSection(categories: { id: PhotoCategoryId; label: string; count: number }[]): string` — system-prompt text: lists categories with counts; rules: call `send_photos` when the client asks for photos/pictures; if the category is unclear ask one short question which one; on `already_sent` say the photos were sent above; on `no_photos` say there are none; on `blocked` say the photos will be sent shortly; never claim to have sent photos unless the tool returned `queued`; mentions that this question is the only exception to the "never ask" rule.

- [ ] **Step 1: Write failing tests** for `decidePhotoRequest` (mock store + `getSendCapacity`): `'room_3'` → `invalid_category`; sent before → `already_sent`; zero photos → `no_photos`; capacity 3 with 5 photos → `blocked`; two already queued → `limit_reached`; all good → `queued`. And `buildPhotoTool`: after a `queued` execute, `queued` array contains the id; after a non-queued result it does not.
- [ ] **Step 2: Run** `npm test --workspace=backend -- photos/tool` → FAIL.
- [ ] **Step 3: Implement** `tool.ts`, `getSendCapacity`, and the `supportsTools` flag.
- [ ] **Step 4: Run** tests → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Verify tool support manually** against the provider docs / a one-off call for each existing model id in `model-pricing.ts`; set `supportsTools` to `false` for any that cannot do tool calls.
- [ ] **Step 6: Commit** `feat(photos): AI tool, request decision and capacity check`.

### Task 5: Wire the tool into `generateReply`

**Files:**
- Modify: `backend/src/services/ai/generate.ts`
- Test: `backend/src/services/ai/generate.photos.test.ts`

**Interfaces:**
- Consumes: Task 4 `buildPhotoTool`, `photoPromptSection`; store `tenantHasPhotos`, `listPhotoSummary`.
- Produces: `GenerateReplyResult` gains `photoCategories: PhotoCategoryId[]` (empty when none queued). `generateReply` behaviour:
  - when `conversationId` is set, `tenantHasPhotos(tenant.id)` is true and the resolved text model has `supportsTools`, pass `tools: { send_photos }` and `maxSteps: 3` to `generateText` and append `photoPromptSection(...)` to the system message; otherwise behaviour is unchanged (no tools, `photoCategories: []`).
  - all existing `generateText` call sites in the function share one helper so the vision-direct and plain paths both get the tool; `logTextUsage` still logs the summed usage.
  - if the final text is empty after tool calls, fall back to a short default (`Фото отправляю.` when something was queued).

- [ ] **Step 1: Write failing tests** (mock `ai` `generateText`, `providers`, `rag`, `usageLog`, photos store): no photos → `generateText` called without `tools` and result `photoCategories` is `[]`; photos + `supportsTools` → `tools.send_photos` present, system message contains the category labels; a mocked tool execution that queues `room_4` surfaces `photoCategories: ['room_4']`.
- [ ] **Step 2: Run** `npm test --workspace=backend -- generate.photos` → FAIL.
- [ ] **Step 3: Implement** the change.
- [ ] **Step 4: Run** all backend tests → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(photos): let the AI queue photo categories`.

### Task 6: Send photos after the reply

**Files:**
- Create: `backend/src/services/photos/send.ts`
- Modify: `backend/src/services/whatsapp/outbound.ts` (add `sendHumanLikePhoto`), `backend/src/services/inboundBuffer/flush.ts`
- Test: `backend/src/services/photos/send.test.ts`

**Interfaces:**
- Consumes: Task 2 store, Task 5 `photoCategories`, `canSendAndIncrement`.
- Produces:
  - `sendHumanLikePhoto(args: { tenantId: string; sock: Sock; jid: string; image: Buffer; mimeType: string }): Promise<{ sent: boolean; reason?: string }>` — same limit check as `sendHumanLikeText`, a 1–3 s `randomBetween` delay, then `sock.sendMessage(jid, { image, mimetype })`.
  - `sendQueuedPhotos(args: { tenantId: string; conversationId: string; jid: string; sock: Sock; categories: PhotoCategoryId[] }): Promise<{ ok: boolean; reason?: string }>` — per category: load photos, send each with `sendHumanLikePhoto`, `appendMessage` each as `direction: 'outgoing', sentBy: 'ai', content: null, mediaType: 'image'`, emit `message:new`; after the *whole* category succeeded call `recordCategorySent`. On the first failed send stop and return `{ ok: false, reason }` without recording that category.
  - `flush.ts`: after the AI text is sent and stored, if `reply.photoCategories.length`, call `sendQueuedPhotos`; on `ok: false` call `setStatus(conversationId, 'awaiting_human', { handoffReason: reason ?? 'photo_send_failed' })`. The `scheduleFollowups` call still runs only after the photos are done or failed-handled.

- [ ] **Step 1: Write failing tests** (mock store, `outbound`, `appendMessage`, `emitToTenant`): all photos sent → `recordCategorySent` called once per category and one `appendMessage` per photo; the 3rd of 5 sends fails → returns `{ ok: false }`, `recordCategorySent` not called for that category, stops sending; empty category list → returns `{ ok: true }` with no calls.
- [ ] **Step 2: Run** `npm test --workspace=backend -- photos/send` → FAIL.
- [ ] **Step 3: Implement** `send.ts`, `sendHumanLikePhoto`, and the `flush.ts` change.
- [ ] **Step 4: Run** all backend tests → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(photos): send queued photos after the AI reply`.

### Task 7: Cabinet page

**Files:**
- Create: `frontend/src/pages/tenant/PhotosPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/app/photos`, nav link `{ to: '/app/photos', label: 'Фото' }`), `frontend/src/lib/api.ts` (add `fetchBlob(path: string): Promise<Blob>` using the same Authorization header and 401 handling as `apiRequest`)

**Interfaces:**
- Consumes: Task 3 endpoints (`GET /tenant/photos`, `POST /tenant/photos/:category` via `apiRequest` with `formData`, `DELETE /tenant/photos/:id`, `GET /tenant/photos/:id/image` via `fetchBlob` → `URL.createObjectURL` for thumbnails).
- Produces: `export function PhotosPage()` — one card per category showing label, `n / 10`, thumbnails with a delete button each, and an upload button (accepts `image/*`, multiple files uploaded sequentially) that is disabled at 10; errors from the API shown with `toast.error`; follows the style of `KnowledgePage` in `SimplePages.tsx`.

- [ ] **Step 1: Implement** `fetchBlob`, the page, route and nav link.
- [ ] **Step 2: Verify** `npm run build --workspace=frontend` succeeds with no type errors.
- [ ] **Step 3: Manual check** with `npm run dev:backend` + `npm run dev:frontend`: upload 10 photos into one category, the 11th is rejected with a message, delete one and upload again, thumbnails load.
- [ ] **Step 4: Commit** `feat(photos): photos page in the tenant cabinet`.

### Task 8: End-to-end check and rollout

- [ ] **Step 1:** `npm test --workspace=backend` and `npx tsc --noEmit` (backend) and `npm run build` (root) all pass.
- [ ] **Step 2: Local scenario** with a connected test WhatsApp number: upload photos to `room_4` and `room_6`; ask "есть фото 4-местного номера?" → text then 4-room photos; ask again → "sent above" text and no photos; ask for 6-room → its photos are sent; ask "есть фото номера?" → one clarifying question; ask for a category with no photos → "no photos" text.
- [ ] **Step 3:** Ask the user before pushing/deploying. After deploy, check Railway logs for errors around the first real client request (`env -u RAILWAY_API_TOKEN railway logs`).
