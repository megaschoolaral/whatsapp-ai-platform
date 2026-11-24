# Hostel photos the bot can send — design

## Intent
Clients of a hostel tenant often ask "do you have photos?". Today the bot only answers in text ("we have photos on Tugista") and the client has to look elsewhere. The tenant admin should upload photos to the platform, and the bot should send the right ones into the WhatsApp chat when the client asks.

## Goals
- Tenant admin uploads photos in the tenant cabinet (new "Photos" page), into fixed categories.
- When a client asks for photos of something, the AI sends all photos of that category into the chat as images.
- If the category is unclear ("do you have room photos?"), the AI asks which one ("how many people is the room for?") instead of guessing.

## Non-goals
- Video, documents, sending photos on every message automatically.
- Storing photos that clients send.
- Admin-defined (free-form) categories.

## Categories (fixed list, not editable)
Kitchen, Bathroom, Rest area, 2-person room, 4-person room, 6-person room, 8-person room, 10-person room. Labels shown in the cabinet and to the AI are in Russian ("Кухня"/"Ас үй" wording is the admin's choice at build time; the stored key is a stable id such as `kitchen`, `bathroom`, `lounge`, `room_2`…`room_10`).

## Behaviour
- Up to 10 photos per category. Upload beyond 10 is rejected with a clear message. Admin can delete photos.
- On client request, the bot sends a short text, then all photos of that category (up to 10), one after another with small delays (reuse the anti-ban pacing in `outbound.ts`).
- Each photo send counts toward the existing anti-ban limits.
- A category already sent in the same conversation is not sent again: the AI answers in text that the photos were sent above. A different category (e.g. 4-person after 6-person) is sent normally.
- Sent photos appear in the inbox conversation as outgoing AI messages.
- If a category has no photos, the AI says so and does not invent any.

## Constraints
- Stack as in CLAUDE.md. All queries filter by `tenantId`; use `tenantIsolation`.
- Railway has no persistent filesystem, so photos are stored in Postgres (bytea), compressed on upload with `sharp` (already a dependency).
- The AI call (`backend/src/services/ai/generate.ts`, Vercel AI SDK `generateText`) currently has no tools; it needs a "send photos" tool that does not break existing replies, retries, token/cost logging, or any provider.
- The tenant can be on any provider configured in the platform; the tool must work for those that support tool calls, and degrade to normal text replies where it cannot.

## Decided by the user
- Photos uploaded to the platform, bot sends them.
- Categories as above, 10 photos each.
- Client asks for a category, gets that category.
- Repeated request for the same category: reply that it was sent above. Different category: send.
- The Photos page and the tool are available to every tenant (no tenant type or flag); the category list is the same fixed hostel list for all.

## Left to the builder
- Table shape, API routes, cabinet page layout, how to remember "already sent in this conversation", exact delay between photos, file size and type limits, tool name and prompt wording.

## Calls made by the designer (not decided by the user — check these)
- Anti-ban cap: before sending, check the remaining hourly/daily capacity. If the whole category does not fit, send nothing, do not record it as sent, and the AI tells the client in text that the photos will follow (conversation moves to a human, as other blocked sends already do).
- Providers without tool-call support: no photo sending and no non-AI keyword fallback. The tool and the prompt mention of photos are enabled only when the tenant has at least one photo and the provider supports tools.
- "Already sent": tracked per DB conversation, forever, by category. If the admin changes a category's photos afterwards, the record resets for that category.
- Order: the tool only queues the photos; the reply text is sent first, then the photos. A retried generation must not queue them twice.
- One category per tool call; at most 2 categories per reply (max 20 photos).
