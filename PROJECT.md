## Project

**AI Platform — WhatsApp**

SaaS-платформа AI-агента для автоматизации клиентских обращений через WhatsApp. Платформа обслуживает одного клиента (Acme Print / Acme Weddings) с двумя бизнес-направлениями, каждое из которых работает как отдельный тенант с изолированными данными, настройками и каналами.

**Core Value:** AI-агент автоматически и естественно отвечает клиентам в WhatsApp от имени бизнеса, используя базу знаний и контекст разговора — без участия человека в 90%+ обращений. Оператор имеет возможность вручную взять любой разговор на себя через дашборд.

**Что делает платформа (TL;DR):**
Когда клиент пишет в WhatsApp бизнеса, AI-агент читает сообщение, ищет нужную информацию в базе знаний (каталог, цены, правила) и отвечает естественно — как живой менеджер. Поддерживает текст, голосовые (через Soniox) и изображения. Два бизнеса (Acme Print и Acme Weddings) работают как отдельные тенанты в одной системе со своими номерами, базами знаний и характером AI. Live-дашборд позволяет оператору в реальном времени видеть все разговоры и подключаться, когда AI не справляется.

### Constraints

- **Tech stack**: Node.js + Express (backend), React + Tailwind CSS + ShadCN (frontend, mobile-friendly), PostgreSQL, Redis
- **WhatsApp**: Baileys (бесплатный, через QR-код) — не официальный API
- **Хостинг**: Railway — монолитное приложение
- **Архитектура**: Монолит с мультитенантной структурой БД (tenant_id)
- **Стратегия**: Строим фундамент, каналы и AI параллельно по слоям

## Technology Stack

## Recommended Stack
### Core Backend
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 20 LTS (or 22 LTS) | Runtime | Project constraint. Node 20+ required by Baileys 7.x. Use LTS for Railway stability. | HIGH |
| Express.js | 4.x (stable) | HTTP framework | Project constraint. Sufficient for this monolith -- no need for Fastify's throughput at this scale. Express 5.x is released but ecosystem middleware compatibility is still catching up; stick with 4.x. | HIGH |
| TypeScript | 5.x | Type safety | Non-negotiable for a project this complex. Baileys is written in TS, Prisma generates TS types, and multi-provider AI integrations need typed interfaces. | HIGH |
### Database & Cache
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| PostgreSQL | 16+ | Primary database | Project constraint. Multi-tenant with tenant_id column isolation. Railway provides managed Postgres. | HIGH |
| Redis | 7+ | Cache, sessions, queues | Project constraint. Railway one-click Redis. Used for: BullMQ job queues, session cache, rate limiting, adaptive inbound message buffering (см. Inbound Message Buffering). | HIGH |
| Prisma ORM | 7.x | Database access | Pure TypeScript since v7 (no Rust engine). 1.6MB vs old 14MB binary -- critical for Railway deploys. Declarative schema + migrations + type-safe queries. Prisma over Drizzle because: gentler learning curve, better migration tooling, and this project is not edge/serverless where Drizzle's bundle size matters. | HIGH |
### Frontend
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React | 19.x | UI framework | Project constraint. Mature ecosystem for dashboard-style apps. | HIGH |
| Vite | 6.x | Build tool | Fast HMR, first-party Tailwind v4 plugin + ShadCN (mobile-friendly). Standard for React projects in 2025+. | HIGH |
| Tailwind CSS + ShadCN (mobile-friendly) | 4.x (4.2+) | Styling | Project constraint. v4 is 5x faster builds, zero-config with `@import "tailwindcss"`. Use `@tailwindcss/vite` plugin. | HIGH |
| React Router | 7.x | Routing | Standard for React SPAs. Supports nested layouts for dashboard structure. | HIGH |
| Zustand | 5.x | State management | Lightweight, no boilerplate. Perfect for tenant switching, auth state, chat state. Redux is overkill for this scope. | MEDIUM |
| Socket.IO Client | 4.x | Real-time updates | Pairs with server. Auto-reconnection critical for live chat dashboard. | HIGH |
### Messaging Channels
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Baileys | 7.x (7.0.0-rc.9) | WhatsApp connection | Project constraint. Free, QR-code based. **CRITICAL RISK: unofficial API, accounts CAN get banned.** See Pitfalls. Requires careful anti-ban patterns: human-like delays, no bulk messaging, session persistence. | HIGH (tech), LOW (stability) |
### AI & LLM
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| OpenAI API (`@ai-sdk/openai`) | Latest | Text + Vision provider option | GPT-5.1 — universal: текст и vision. ~$1.25 input / $10 output per 1M tokens. Tenant выбирает в админке. Еще в админке для каждой модели должны быть показаны цены для каждой модели. Vision используется для анализа фото от клиентов (например, фото свадебного приглашения). |  HIGH |
| Google Gemini API (`@ai-sdk/google`) | Latest | Text + Vision + RAG | Gemini 3 Flash — текст и vision, ~$0.50/$3 per 1M tokens. **Gemini API key обязателен для всех тенантов** даже если они не используют Gemini для текста — нужен для File Search RAG (см. ниже). | HIGH |
| xAI Grok API (`@ai-sdk/xai`) | Latest | Text provider option (cheapest) | Grok 4.1 Fast — самая дешёвая опция, ~$0.20/$0.50 per 1M tokens, 2M context. **Vision слабый — не использовать для image analysis.** Если у тенанта выбран Grok и приходит сообщение с фото → fallback на vision-провайдер тенанта. | HIGH |
| Vercel AI SDK | 5.x | Multi-provider abstraction | **NB: это библиотека (npm package), а не хостинг Vercel.** Работает на Railway без проблем. Даёт единый API для OpenAI / Gemini / Grok: streaming, tool calling, structured output, vision. Без неё пришлось бы писать 3 отдельных клиента. См. AI Models & Provider Configuration. | HIGH |
### RAG & Knowledge Base
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Gemini File Search API | Latest | Document RAG | Project constraint. Fully managed: upload files, get answers with citations. Supports PDF, DOCX, TXT, JSON. No vector DB needed. Free storage, pay only for embedding creation ($0.15/1M tokens). | HIGH |
### Voice Transcription
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| ElevenLabs Scribe v2 | Latest | Speech-to-text option | 90+ языков включая русский и казахский. Keyterm prompting для бизнес-словаря. REST API. SOC 2 / GDPR. ~$0.40/час. Tenant выбирает в админке. | HIGH |
| Soniox | Latest | Speech-to-text option | Отличное качество для **казахского языка** — лучше чем ElevenLabs для kk. Real-time + async транскрипция. Tenant выбирает в админке. Использовать для тенантов с казахоязычной аудиторией. | HIGH |
### Real-Time & Background Jobs
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Socket.IO | 4.x | WebSocket server | Real-time chat dashboard, live notifications. Auto-reconnection, rooms (per-tenant isolation), namespaces. Handles flaky connections better than raw `ws`. | HIGH |
| BullMQ | 5.x (5.71+) | Job queue | Adaptive inbound buffering (см. Inbound Message Buffering), scheduled broadcasts, AI response processing, voice transcription jobs, outbound message rate limiting. Redis-backed, persistent, retries, rate limiting. Superior to node-cron for anything needing persistence or retry. | HIGH |
| node-cron | 3.x | Simple scheduling | Lightweight periodic tasks: token refresh, session health checks, cleanup jobs. No persistence needed for these. | HIGH |
### Authentication & Security
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| jsonwebtoken | 9.x | JWT creation/verification | Standard JWT library. Stateless auth tokens for API. | HIGH |
| bcryptjs | 2.x | Password hashing | Pure JS (no native deps = easy Railway deploy). Use over `bcrypt` to avoid build issues. | HIGH |
| helmet | 8.x | HTTP security headers | Express middleware, one-line setup. | HIGH |
| cors | 2.x | CORS configuration | Required for separate frontend origin. | HIGH |
### File Handling
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| multer | 1.x | File upload middleware | Standard for Express. Handle knowledge base file uploads (PDF, DOCX, TXT). | HIGH |
| sharp | 0.33+ | Image processing | Compress/resize customer photos before AI analysis. Reduces API costs and latency. | MEDIUM |
### Logging & Monitoring
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | 9.x | Structured logging | Fast JSON logger. Use over winston -- 5x faster, better for production. Structured logs work well with Railway log viewer. | HIGH |
| pino-pretty | 13.x | Dev log formatting | Human-readable dev logs. | HIGH |
### Validation
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| zod | 3.x | Schema validation | Runtime type validation for API inputs, webhook payloads, AI responses. Pairs perfectly with TypeScript. | HIGH |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| ORM | Prisma 7.x | Drizzle ORM | Drizzle is faster/smaller but project isn't edge/serverless. Prisma's migration tooling and learning curve advantage matter more here. |
| HTTP Framework | Express 4.x | Fastify | Project constraint. Express is sufficient for this scale (single client, two tenants). Fastify's 3x throughput advantage is irrelevant here. |
| State Management | Zustand | Redux Toolkit | Redux is overkill for two-tenant dashboard. Zustand has no boilerplate. |
| Job Queue | BullMQ | Agenda.js | Agenda requires MongoDB. We already have Redis for BullMQ. |
| Logger | pino | winston | pino is 5x faster and produces structured JSON natively. |
| Password Hashing | bcryptjs | bcrypt | bcrypt requires native compilation which can fail on Railway. bcryptjs is pure JS, same API. |
| AI Abstraction | Vercel AI SDK | Custom wrapper | AI SDK handles streaming, tool calling, structured output, vision across multiple providers. Building this from scratch for 3 providers would be 200-300 lines of fragile code. |
| WebSocket | Socket.IO | ws | Socket.IO's auto-reconnection, rooms, and namespaces are worth the overhead for a chat dashboard. |
## NOT Recommended (Explicit Anti-Stack)
| Technology | Why Not |
|------------|---------|
| Next.js | Project specifies separate React frontend + Express backend. Next.js would merge them, complicating Railway deployment and the monolith architecture. |
| MongoDB | PostgreSQL is the constraint. No reason to add a second database. |
| Sequelize / TypeORM | Inferior DX compared to Prisma 7.x. Sequelize has stale development. TypeORM has known issues with complex queries. |
| Firebase | Vendor lock-in, doesn't align with self-hosted PostgreSQL constraint. |
| Pinecone / Weaviate | Gemini File Search API is the constraint for RAG. No need for external vector DB. |
| WhatsApp Cloud API | Costs money per conversation. Baileys is free (project constraint), though riskier. |
| Passport.js | Over-engineered for single-strategy JWT auth. Plain jsonwebtoken + middleware is simpler and sufficient. |
| Together.ai | Изначально рассматривался для self-hosted моделей (Qwen). Слишком сложно для не-технических студентов курса. Готовые managed модели (OpenAI / Gemini / Grok) проще для обучения и достаточны по качеству. |
| Anthropic Claude API | Дорогой для production воркфлоу с высоким объёмом сообщений (Claude Sonnet ~$3/$15, Opus ~$15/$75 per 1M tokens). Студентам нужны cheap-options для их клиентов. Если конкретный тенант хочет качество выше — добавляется как ещё одна опция в Text Model selector, но не входит в дефолт. |
## Installation
# Core backend
# AI & messaging
# Dev dependencies
# Frontend
## Environment Variables Required
# Database
# Auth
# WhatsApp (Baileys)
# No env vars needed -- QR code auth, session stored in DB/filesystem
# AI Providers
# Voice
# App
## Key Version Constraints
| Dependency | Min Version | Reason |
|------------|-------------|--------|
| Node.js | 20.0.0 | Required by Baileys 7.x |
| Redis | 4.0+ | Required by BullMQ |
| PostgreSQL | 14+ | Prisma 7 requirement |
## Sources
- [Baileys GitHub (WhiskeySockets)](https://github.com/WhiskeySockets/Baileys) -- v7.0.0-rc.9, Node 20+ required
- [Baileys ban issues](https://github.com/WhiskeySockets/Baileys/issues/1869) -- account ban risk documentation
- [Gemini File Search API](https://ai.google.dev/gemini-api/docs/file-search) -- managed RAG, free storage
- [OpenAI API Pricing](https://openai.com/api/pricing) -- GPT-5.1 ~$1.25/$10 per 1M tokens
- [Google Gemini API Pricing](https://ai.google.dev/pricing) -- Gemini 3 Flash ~$0.50/$3 per 1M tokens
- [xAI Grok API Docs](https://docs.x.ai/docs/models) -- Grok 4.1 Fast ~$0.20/$0.50 per 1M tokens, 2M context
- [Vercel AI SDK](https://sdk.vercel.ai/docs) -- v5.x, open-source npm package (не привязан к хостингу Vercel)
- [ElevenLabs Scribe v2](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) -- 90+ languages, REST API
- [Soniox](https://soniox.com/) -- best-in-class для казахского языка
- [Prisma 7 announcement](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0) -- pure TS, no Rust engine
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) -- 5x faster builds, Vite plugin
- [Shadcn] https://ui.shadcn.com/
- [BullMQ](https://docs.bullmq.io) -- v5.71, Redis-based job queue
- [Railway Redis guide](https://docs.railway.com/guides/redis) -- one-click deployment
- [Socket.IO](https://socket.io/) -- v4.x, auto-reconnection, rooms

## Manual Reply & Human Takeover

Платформа автоматизирует 90%+ обращений, но оператор должен иметь возможность взять разговор на себя в любой момент. Эта секция описывает поведение ручного ответа и передачи AI ↔ человек.

### Conversation States

Каждый разговор находится в одном из четырёх состояний:

| State | Description | AI behavior |
|-------|-------------|-------------|
| `ai_active` | AI обрабатывает обращения автоматически | Отвечает на все входящие |
| `human_active` | Оператор ведёт разговор вручную | AI приостановлен для этого контакта |
| `awaiting_human` | AI запросил передачу человеку | AI не отвечает, в дашборде — флаг внимания |
| `resolved` | Разговор завершён | AI снова активен при новом сообщении |

### Manual Reply Capabilities

Из дашборда оператор может:
- Отправлять текстовые сообщения
- Отправлять изображения (через Baileys)
- Отправлять голосовые сообщения (опционально, фаза 2)
- Видеть индикатор «AI печатает...» и приостанавливать AI до отправки своего ответа
- Помечать разговор как `resolved` для возврата к AI

### Auto-Handoff Triggers (AI → Human)

AI автоматически переводит разговор в `awaiting_human` когда:
- Customer пишет ключевые слова: «оператор», «менеджер», «человек», «живой человек», «жалоба», «возврат»
- AI confidence score < threshold (configurable per tenant)
- Customer отправил 3+ сообщения подряд без получения удовлетворительного ответа (configurable)
- Triggered by tenant-specific rules (например, упоминание определённых сумм или продуктов)

### Auto-Resume Rules (Human → AI)

Разговор возвращается в `ai_active` когда:
- Оператор явно нажимает «Resolved» / «Return to AI»
- Operator inactivity timeout: настраивается per tenant (default: 24 часа без активности оператора в этом разговоре)
- Customer не пишет N дней (default: 7 дней)

### Critical Constraints

- **Single source of replies**: ВСЕ ручные ответы идут через дашборд, не через телефон. Параллельные ответы из WhatsApp app на телефоне могут вызвать конфликт сессий Baileys.
- **AI lock during human reply**: Когда оператор открыл разговор и начал печатать, AI блокируется на этот контакт даже если разговор всё ещё в `ai_active` — чтобы избежать одновременного ответа.
- **Audit trail**: Каждое сообщение должно иметь `sent_by` поле (`ai` | `operator_id` | `customer`) для аналитики и отладки.

### UI Requirements

Дашборд должен показывать:
- Список разговоров с фильтрами по state (`awaiting_human` — приоритет)
- Индикатор «AI / Human» рядом с каждым разговором
- Кнопку «Take over» / «Return to AI» в открытом разговоре
- Real-time обновления через Socket.IO (новое сообщение → push в UI без refresh)
- Счётчик непрочитанных в `awaiting_human` (badge с числом)

### Database Schema Additions

```typescript
// Conversation
status: 'ai_active' | 'human_active' | 'awaiting_human' | 'resolved'
assigned_operator_id: string | null
last_human_activity_at: timestamp | null
handoff_reason: string | null  // why AI handed off

// Message
sent_by: 'ai' | 'customer' | string  // operator user_id if manual
ai_confidence: float | null  // for AI messages, used for handoff logic
```

## Inbound Message Buffering

**Проблема:** Клиенты в WhatsApp пишут короткими сообщениями подряд:
```
[14:32:01] привет
[14:32:04] хочу заказать виньетки
[14:32:09] на свадьбу
[14:32:15] на 50 человек
[14:32:22] сколько будет стоить?
```

Если AI отвечает на каждое сообщение сразу — он спамит частичными ответами и выглядит тупо. Если ждёт фиксированное время — либо отвечает преждевременно (теряя контекст), либо заставляет клиента ждать слишком долго.

**Решение:** Adaptive buffer на основе presence-сигналов от WhatsApp + динамические задержки.

### Adaptive Buffer Logic

```typescript
// Псевдокод поведения буфера для одного контакта (per tenant_id + contact_jid)

onIncomingMessage(msg) {
  appendToBuffer(contactKey, msg)

  // Если уже есть активный таймер — продлеваем
  resetTimer(contactKey, INITIAL_WAIT_MS) // 15 секунд
}

onPresenceUpdate(jid, presence) {
  if (presence === 'composing' && bufferExists(contactKey)) {
    // Клиент снова печатает — продлеваем окно
    resetTimer(contactKey, COMPOSING_EXTEND_MS) // ещё 15 секунд
  }

  if (presence === 'paused' && bufferExists(contactKey)) {
    // Клиент остановился — короткий final wait и отправляем
    resetTimer(contactKey, PAUSED_FINAL_WAIT_MS) // 5 секунд
  }
}

onTimerFired(contactKey) {
  // Hard cap: если буфер живёт > 60 сек, отправляем принудительно
  if (bufferAge(contactKey) > HARD_CAP_MS) {
    flush(contactKey)
    return
  }

  flush(contactKey) // отправляем все накопленные сообщения в AI как один контекст
}
```

### Timing Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `INITIAL_WAIT_MS` | 15000 (15 сек) | Базовое окно после первого сообщения |
| `COMPOSING_EXTEND_MS` | 15000 (15 сек) | Продление при детекте "composing" presence |
| `PAUSED_FINAL_WAIT_MS` | 5000 (5 сек) | Финальное ожидание после "paused" |
| `HARD_CAP_MS` | 60000 (60 сек) | Максимальное время жизни буфера, после — принудительный flush |

Не делать эти значения рандомными — это **inbound** буфер, рандомизация здесь не нужна (рандом нужен только для **outbound** задержек, см. Baileys Anti-Ban Patterns). Здесь логика человекоподобная за счёт реакции на presence, а не за счёт случайности.

### Implementation Notes

- **Реализация через BullMQ delayed jobs**: при каждом новом сообщении создавать/обновлять delayed job с ключом `buffer:${tenantId}:${contactJid}`. При срабатывании — flush.
- **Хранение буфера**: Redis hash или sorted set с TTL = 90 сек (с запасом над hard cap). Структура: `buffer:${tenantId}:${contactJid}` → массив `{messageId, text, mediaUrl, timestamp}`.
- **Presence subscription**: при первом сообщении от контакта вызывать `sock.presenceSubscribe(jid)` чтобы Baileys начал получать updates.
- **Race condition guard**: при flush лочить буфер (Redis SETNX), чтобы параллельный incoming message не создал второй flush.
- **Manual reply override**: если оператор открыл разговор и взял `human_active`, буфер должен немедленно flush'нуться в дашборд (не ждать таймер) и AI не должен обрабатывать.

### Two Different Delay Mechanisms (важно не путать)

В платформе **два разных** механизма задержек, не один:

| Механизм | Где | Тайминги | Зачем |
|----------|-----|----------|-------|
| **Inbound buffering** (этот раздел) | Перед отправкой в AI | 15-60 сек, adaptive по presence | Группировать кусочные сообщения клиента в полный контекст |
| **Outbound delay** (см. Baileys Anti-Ban Patterns) | После генерации AI ответа, перед `sendMessage` | 2-8 сек рандомно + typing simulation | Имитировать человеческое поведение, anti-ban |

Inbound — про вход данных, fixed adaptive логика. Outbound — про выход, рандомизированный. Не смешивать.

## Baileys Anti-Ban Patterns

**КРИТИЧНО**: Baileys — неофициальный WhatsApp API. WhatsApp активно банит номера за «бот-подобное» поведение. Бан = потеря номера навсегда (не только сессии). Эти правила обязательны для всего кода, который отправляет сообщения через Baileys.

### Hard Rules (никогда не нарушать)

1. **НЕ использовать личные номера** — только отдельные SIM-карты, желательно с историей использования (минимум 2-4 недели активности перед подключением к Baileys).
2. **НЕ отправлять сообщения быстрее 2 секунд после получения** — мгновенный ответ = детект бота. Минимум 2-5 секунд задержка перед отправкой.
3. **НЕ делать bulk-рассылки без очереди с паузами** — отправка >10 сообщений подряд без задержек = моментальный бан.
4. **НЕ отправлять одинаковый текст разным контактам** — даже шаблоны должны быть рандомизированы (вариации фраз, эмодзи, пунктуации).
5. **НЕ пересоздавать сессию при каждом старте** — `creds.json` и `keys/` должны персистится в БД или Railway volume. Постоянные re-auth = красный флаг.
6. **НЕ отправлять медиа подряд** — если AI должен отправить 3 фото, разделять их текстовыми сообщениями или паузами 5+ секунд.
7. **НЕ использовать один номер для двух тенантов** — у Acme Print и Acme Weddings ДОЛЖНЫ быть разные номера и разные Baileys-сессии.

### Required Behavioral Patterns

#### Typing Simulation (обязательно для каждого ответа)

Перед отправкой сообщения имитировать набор текста:

```typescript
// 1. Mark as read (не сразу — через 1-3 сек после получения)
await delay(randomBetween(1000, 3000))
await sock.readMessages([msg.key])

// 2. Show "typing..." presence
await sock.sendPresenceUpdate('composing', jid)

// 3. Realistic typing delay: ~50-80ms per character, capped
const typingMs = Math.min(message.length * randomBetween(50, 80), 8000)
await delay(typingMs)

// 4. Stop typing, then send
await sock.sendPresenceUpdate('paused', jid)
await delay(randomBetween(300, 800))
await sock.sendMessage(jid, { text: message })
```

#### Randomized Delays Between Outbound Messages

| Action | Min delay | Max delay |
|--------|-----------|-----------|
| Reply to incoming message | 2s | 8s |
| Send next message in same conversation | 3s | 10s |
| Send to different contact (sequential) | 15s | 45s |
| After sending media | 5s | 15s |

Реализовать через **BullMQ rate limiter** на очереди отправки — не через `setTimeout` в коде. Это даёт persistence при рестартах и точный контроль RPS per session.

#### Daily/Hourly Send Limits (per WhatsApp number)

| Period | Soft limit | Hard limit | Notes |
|--------|------------|------------|-------|
| First 7 days (warmup) | 20 msg/day | 50 msg/day | Только ответы, без инициативных |
| Days 8-14 | 100 msg/day | 200 msg/day | Можно начинать broadcasts |
| Day 15+ (warmed) | 500 msg/day | 1000 msg/day | Нормальный режим |
| Any time, per hour | 30 msg/hour | 80 msg/hour | Распределять по времени, не пиками |

Hard limits — это потолки в коде, выше которых очередь отказывается отправлять (возвращает в `awaiting_human`). Soft limits — алерты в логах.

### Warmup Protocol (новый номер)

При первом подключении номера к платформе:

1. **Дни 1-3**: Только ручные ответы оператором через дашборд (AI выключен). 5-10 сообщений в день.
2. **Дни 4-7**: AI включен только для ответов на существующие чаты. Без broadcasts. Лимит 20 msg/день.
3. **Дни 8-14**: AI работает в нормальном режиме, но broadcasts запрещены. Лимит 100 msg/день.
4. **День 15+**: Полный режим, broadcasts разрешены через очередь с лимитом 80 msg/час.

Хранить `warmup_started_at` в таблице `tenants` или `whatsapp_sessions`. Очередь отправки должна проверять текущий день warmup и применять лимит.

### Session Management

- **Хранить session credentials в PostgreSQL** (зашифрованно через `crypto` AES-256), не в файловой системе. Railway volumes могут пересоздаваться при деплое.
- **Использовать `useMultiFileAuthState`-аналог с DB backend** — есть готовые библиотеки (`@whiskeysockets/baileys` поддерживает custom auth state).
- **При reconnect**: использовать существующую сессию, никогда не запрашивать QR повторно если creds существуют.
- **Логировать все disconnect events** с `DisconnectReason` — некоторые коды (`loggedOut = 401`) означают бан или logout с другого устройства.

### Disconnect Reason Handling

```typescript
import { DisconnectReason } from '@whiskeysockets/baileys'

const reason = (lastDisconnect?.error as Boom)?.output?.statusCode

switch (reason) {
  case DisconnectReason.loggedOut: // 401
    // CRITICAL: Сессия убита (бан или logout с телефона). НЕ переподключаться автоматически.
    // Уведомить оператора, требуется новый QR.
    await alertOperator('WhatsApp session terminated. Manual re-auth required.')
    break

  case DisconnectReason.connectionReplaced: // 440
    // Сессия открыта в другом месте. Не переподключаться — иначе цикл.
    break

  case DisconnectReason.restartRequired: // 515
  case DisconnectReason.connectionLost: // 408
  case DisconnectReason.timedOut: // 408
    // Безопасно переподключиться с экспоненциальной задержкой
    await reconnectWithBackoff()
    break

  default:
    await reconnectWithBackoff()
}
```

### What Looks Like a Bot (избегать)

- ❌ Идеально точная пунктуация и грамматика во всех сообщениях
- ❌ Одинаковая длина сообщений
- ❌ Отсутствие пауз/эмодзи/опечаток (иногда полезно «ошибаться»)
- ❌ Ответы 24/7 без перерывов — добавить «рабочие часы» с замедленными ответами или авто-handoff в нерабочее время
- ❌ Одновременная отправка сообщений в N чатов в одну и ту же секунду (queue rate limiter решает это)
- ❌ Игнорирование read receipts (сообщения должны быть отмечены прочитанными)

### Monitoring Signals (что мониторить)

Эти метрики — ранние индикаторы проблем с номером:

- **Message send failure rate** > 5% за час — возможен soft-ban
- **`DisconnectReason.loggedOut` events** — критичный алерт оператору
- **Резкое падение incoming messages** при стабильном объёме раньше — возможна теневая блокировка
- **Daily send count vs limit** — приближение к лимиту = алерт
- **Reconnect frequency** > 3 раз за час — нестабильная сессия, возможные проблемы

### Sources

- [Baileys ban issues #1869](https://github.com/WhiskeySockets/Baileys/issues/1869)
- [Baileys auth state docs](https://baileys.wiki/docs/socket/configuration#auth)
- [Baileys DisconnectReason enum](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/State.ts)

## AI Models & Provider Configuration

Каждый тенант имеет независимый выбор моделей по трём осям: **Text**, **Vision**, **STT**. Это даёт клиентам гибкость по цене/качеству/языку. Все API keys per-tenant — клиент платит за свой usage.

### Three Independent Selectors per Tenant

В админке тенанта (UI клиента) три отдельных селектора:

| Selector | Available Options | Используется для |
|----------|-------------------|------------------|
| **Text Model** | OpenAI GPT-5.1, Gemini 3 Flash, Grok 4.1 Fast | Conversational replies (главный AI) |
| **Vision Model** | OpenAI GPT-5.1, Gemini 3 Flash | Анализ изображений от клиентов (фото товара, скрины, документы) |
| **STT Model** | ElevenLabs Scribe v2, Soniox | Транскрипция голосовых сообщений |

**Важно:** Text и Vision — это **разный выбор** даже если оба провайдера одинаковые. Тенант может выбрать Grok для текста (дёшево) + Gemini для vision (Grok vision слабый).

### Pricing Table (актуально на момент написания)

Цены **хардкодятся в файле** `src/config/model-pricing.ts` — рынок LLM меняется каждые 2-3 месяца, и студент обновляет цены через Claude Code без ручного редактирования (см. ниже Pricing Update Workflow).

#### Text Models

| Provider | Model | Input (per 1M) | Output (per 1M) | ≈ per message* | Notes |
|----------|-------|----------------|-----------------|----------------|-------|
| OpenAI | gpt-5.1 | $1.25 | $10.00 | ≈$0.005 | Universal, надёжный, vision встроен |
| Google | gemini-3-flash | $0.50 | $3.00 | ≈$0.002 | Дешёвый, vision встроен, очень быстрый |
| xAI | grok-4.1-fast | $0.20 | $0.50 | ≈$0.0007 | Самый дешёвый, 2M context. **Vision слабый.** |

*Расчёт `≈ per message`: средний разговор ~500 input + 200 output tokens.

#### Vision Models

| Provider | Model | Input (per 1M) | Output (per 1M) | ≈ per image* |
|----------|-------|----------------|-----------------|--------------|
| OpenAI | gpt-5.1 | $1.25 | $10.00 | ≈$0.005 |
| Google | gemini-3-flash | $0.50 | $3.00 | ≈$0.002 |

*Изображение ~1500 input tokens + 200 output.

#### STT Models

| Provider | Model | Цена | Best for |
|----------|-------|------|----------|
| ElevenLabs | Scribe v2 | ~$0.40/час аудио | Русский, английский, мультиязычный |
| Soniox | (latest) | ~$X.XX/час аудио | **Казахский** (лучше ElevenLabs для kk) |

### Pricing Display in UI (Hybrid Format)

В UI тенанта при выборе модели показывать **обе формы**:

```
┌─ Text Model ─────────────────────────────┐
│ ◉ Grok 4.1 Fast                          │
│   $0.20 / $0.50 per 1M tokens            │
│   ≈ $0.0007 per message                  │
│   [ℹ️] 2M context, vision не поддерживает │
│                                          │
│ ○ Gemini 3 Flash                         │
│   $0.50 / $3.00 per 1M tokens            │
│   ≈ $0.002 per message                   │
│                                          │
│ ○ GPT-5.1                                │
│   $1.25 / $10 per 1M tokens              │
│   ≈ $0.005 per message                   │
└──────────────────────────────────────────┘
```

Не-технари видят `≈ $0.005 per message` (понятно), технари видят сырую цену (точно). Tooltip объясняет как считается per-message.

### Pricing Configuration File (hardcoded, not DB)

Цены хранятся в TypeScript-файле, не в БД. Это **сознательное решение** для обучающего проекта: студентам проще обновить цены через Claude Code + git push, чем строить admin UI с валидацией и историей изменений.

```typescript
// src/config/model-pricing.ts
//
// PRICING UPDATE WORKFLOW:
// To update prices, ask Claude Code:
// "Search the web for current API pricing for GPT-5.1, Gemini 3 Flash,
//  Grok 4.1 Fast, ElevenLabs Scribe v2, and Soniox. Update model-pricing.ts
//  with latest values and update lastUpdated date."
// Claude will run web searches, edit this file, you commit & Railway auto-deploys.

export const MODEL_PRICING = {
  text: {
    'gpt-5.1': {
      provider: 'openai' as const,
      modelId: 'gpt-5.1',
      displayName: 'GPT-5.1',
      inputPer1M: 1.25,
      outputPer1M: 10.0,
      avgCostPerMessage: 0.005,
      contextWindow: 1_000_000,
      supportsVision: true,
      isActive: true,
      notes: 'Universal, надёжный, vision встроен',
    },
    'gemini-3-flash': {
      provider: 'google' as const,
      modelId: 'gemini-3-flash',
      displayName: 'Gemini 3 Flash',
      inputPer1M: 0.50,
      outputPer1M: 3.00,
      avgCostPerMessage: 0.002,
      contextWindow: 1_000_000,
      supportsVision: true,
      isActive: true,
      notes: 'Быстрый и дешёвый, vision встроен',
    },
    'grok-4.1-fast': {
      provider: 'xai' as const,
      modelId: 'grok-4-1-fast',
      displayName: 'Grok 4.1 Fast',
      inputPer1M: 0.20,
      outputPer1M: 0.50,
      avgCostPerMessage: 0.0007,
      contextWindow: 2_000_000,
      supportsVision: false,
      isActive: true,
      notes: 'Самый дешёвый, 2M context. Vision слабый — для фото использовать Vision Model.',
    },
  },
  vision: {
    'gpt-5.1': { /* same shape */ },
    'gemini-3-flash': { /* same shape */ },
  },
  stt: {
    'elevenlabs-scribe-v2': {
      provider: 'elevenlabs' as const,
      modelId: 'scribe_v2',
      displayName: 'ElevenLabs Scribe v2',
      pricePerHour: 0.40,
      isActive: true,
      notes: '90+ языков, отлично для русского',
    },
    'soniox': {
      provider: 'soniox' as const,
      modelId: 'latest',
      displayName: 'Soniox',
      pricePerHour: 0.40, // CHECK ACTUAL PRICE
      isActive: true,
      notes: 'Лучшее качество для казахского языка',
    },
  },
  lastUpdated: '2026-05-07',
} as const

// Type-safe helpers
export type TextModelId = keyof typeof MODEL_PRICING.text
export type VisionModelId = keyof typeof MODEL_PRICING.vision
export type SttModelId = keyof typeof MODEL_PRICING.stt
```

### Tenant Model Choices (DB)

Только **выбор тенанта** хранится в БД (не сами цены):

```typescript
// Table: tenant_model_choices
{
  tenant_id: uuid (FK, PK)
  text_model_id: TextModelId       // e.g., 'grok-4.1-fast'
  vision_model_id: VisionModelId   // e.g., 'gemini-3-flash'
  stt_model_id: SttModelId         // e.g., 'soniox'
  updated_at: timestamp
}
```

UI селекторы загружают опции из `MODEL_PRICING` (фильтруя по `isActive: true`) и сохраняют выбор в `tenant_model_choices`. Никакой синхронизации между БД и pricing file не нужно — БД хранит только ID, цены приходят из кода.

### Per-Tenant API Keys

Все ключи хранятся per-tenant. Студент вводит ключи в onboarding, клиент потом может видеть и редактировать в своей админке.

```typescript
// Table: tenant_api_keys (encrypted)
{
  tenant_id: uuid (FK, PK)
  openai_key: encrypted_text | null     // если выбран OpenAI для text/vision
  gemini_key: encrypted_text            // ОБЯЗАТЕЛЬНЫЙ для всех тенантов (RAG)
  xai_key: encrypted_text | null        // если выбран Grok
  elevenlabs_key: encrypted_text | null // если выбран ElevenLabs
  soniox_key: encrypted_text | null     // если выбран Soniox
  updated_at: timestamp
  updated_by: uuid (user_id)
}
```

**Critical: Gemini API key обязателен** для каждого тенанта, даже если они не используют Gemini для текста — он нужен для **File Search RAG** (knowledge base). Это явное требование при onboarding.

### Encryption Rules (mandatory)

- Все ключи шифруются **AES-256-GCM** перед записью в БД
- `ENCRYPTION_KEY` в Railway env vars (32 байта, hex), **никогда** не в коде
- В UI ключи показываются как `sk-...XXXX` (последние 4 символа)
- Кнопка "Reveal" показывает полный ключ только после подтверждения (modal "Are you sure?")
- Ключи **никогда** не попадают в логи (даже частично) — pino redact rules для полей `*_key`
- Аудит-лог: каждое изменение ключа пишется в `api_key_audit_log` (кто, когда, какое поле)

### Vision Fallback Logic

Если у тенанта Text Model = Grok (плохой vision) и приходит сообщение с изображением:

```typescript
async function processIncomingMessage(msg, tenant) {
  if (msg.hasImage) {
    // Использовать Vision Model тенанта (не Text Model)
    const visionResult = await analyzeImage(msg.image, tenant.visionModel)

    // Передать описание изображения в Text Model для генерации ответа
    const reply = await generateText({
      model: tenant.textModel,
      messages: [
        ...history,
        { role: 'user', content: `${msg.text}\n\n[Image description: ${visionResult}]` }
      ]
    })
    return reply
  }

  // Обычный текстовый flow
  return generateText({ model: tenant.textModel, messages: [...history, msg] })
}
```

Это позволяет клиенту использовать Grok для дешёвых текстовых ответов **и** правильно обрабатывать изображения через Gemini/OpenAI vision. Без fallback Grok сгенерировал бы плохое описание фото.

### Vercel AI SDK Usage (это библиотека, не хостинг)

**Важно для студентов:** Vercel AI SDK — это **npm-пакет** (`ai`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`). **Никакой связи с хостингом Vercel нет.** Работает на Railway, на любом сервере, где есть Node.js.

```typescript
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'

// Per-tenant providers (ключи из БД, расшифрованные)
function getProvider(tenant) {
  switch (tenant.textModel.provider) {
    case 'openai':
      return createOpenAI({ apiKey: tenant.apiKeys.openai })(tenant.textModel.modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey: tenant.apiKeys.gemini })(tenant.textModel.modelId)
    case 'xai':
      return createXai({ apiKey: tenant.apiKeys.xai })(tenant.textModel.modelId)
  }
}

// Один вызов для всех провайдеров
const { text } = await generateText({
  model: getProvider(tenant),
  messages: [...]
})
```

Преимущества:
- **Streaming** одинаковый для всех (для "AI печатает..." эффекта в дашборде)
- **Tool calling** одинаковый (например, AI может вызвать функцию `checkInventory(productId)`)
- **Structured output** через `generateObject()` (если нужен JSON по схеме)
- **Vision** через `experimental_attachments` API одинаково для OpenAI и Gemini

### Knowledge Base RAG (Gemini File Search)

Knowledge base каждого тенанта хранится в **Gemini File Search API** под Gemini key тенанта.

- При загрузке PDF/DOCX/TXT через UI → upload в Gemini File Search через tenant.gemini_key
- При входящем сообщении → query File Search → вернуть релевантные чанки + цитаты
- Полученный контекст подмешивается в prompt к Text Model тенанта (даже если Text Model — Grok, не Gemini)

```typescript
// Псевдокод
const ragContext = await geminiFileSearch.query({
  apiKey: tenant.apiKeys.gemini,
  corpusId: tenant.knowledgeBaseCorpusId,
  query: customerMessage,
})

const reply = await generateText({
  model: getProvider(tenant), // может быть Grok, OpenAI, Gemini
  system: `${tenant.aiPersona}\n\nRelevant info from knowledge base:\n${ragContext.text}`,
  messages: [...history]
})
```

Это означает что **клиент платит Gemini за RAG**, даже если основной чат идёт через Grok или OpenAI. **Gemini API key — обязательный для каждого тенанта.**

### Onboarding Flow для нового тенанта

Студент в super-admin панели:

1. Создаёт тенанта: имя бизнеса, email/password для клиента
2. Вводит API keys клиента:
   - **Gemini key** (обязательный — для RAG + опционально как text/vision provider)
   - OpenAI key (опционально)
   - Grok key (опционально)
   - ElevenLabs или Soniox key (опционально)
3. Выбирает дефолтные модели за клиента (Text / Vision / STT)
4. Сканирует WhatsApp QR от номера клиента
6. Загружает knowledge base файлы клиента (PDF/DOCX/TXT) → автоматически индексируются в Gemini File Search
7. Настраивает AI persona (имя бизнеса, тон общения, рабочие часы, приветствие)
8. Активирует тенанта → клиент может логиниться

После онбординга клиент логинится в свою tenant-админку и может:
- Видеть/редактировать свои API keys (с кнопкой Reveal)
- Менять выбор моделей (видя цены) — изменения применяются мгновенно
- Загружать/удалять файлы knowledge base
- Видеть свою AI persona и редактировать
- Видеть все разговоры, отвечать вручную

### Cost Monitoring per Tenant

Логировать каждый AI-вызов в таблицу `ai_usage_log`:

```typescript
{
  id: uuid
  tenant_id: uuid (FK, indexed)
  timestamp: timestamp
  category: 'text' | 'vision' | 'stt' | 'rag'
  provider: string
  model_id: string
  input_tokens: int
  output_tokens: int
  duration_seconds: int | null  // для STT
  estimated_cost_usd: decimal   // вычисляется на основе MODEL_PRICING из config файла
  conversation_id: uuid | null  // для tracing
}
```

Tenant-админка показывает клиенту:
- Usage за текущий месяц (per category)
- Estimated cost (вычисляется через `MODEL_PRICING[category][modelId]`)
- График по дням
- Top conversations по стоимости

Super-admin (студент) видит то же самое **across all tenants**.

### Sources & Pricing References

- [OpenAI Pricing](https://openai.com/api/pricing) — GPT-5.1 standard ~$1.25/$10
- [Google Gemini Pricing](https://ai.google.dev/pricing) — Gemini 3 Flash ~$0.50/$3
- [xAI Grok Pricing](https://docs.x.ai/docs/models) — Grok 4.1 Fast ~$0.20/$0.50, 2M context
- [Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search) — managed RAG, free storage, $0.15/1M tokens for indexing
- [ElevenLabs Scribe v2](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) — 90+ languages
- [Soniox](https://soniox.com/) — high quality для редких языков включая казахский
- [Vercel AI SDK](https://sdk.vercel.ai/docs) — open-source npm package, не привязан к хостингу Vercel

### Pricing Update Workflow

Цены меняются часто (раз в 2-3 месяца у крупных провайдеров). Workflow обновления для студента:

1. Открыть Claude Code в проекте
2. Promпт: *"Search the web for current API pricing for GPT-5.1, Gemini 3 Flash, Grok 4.1 Fast, ElevenLabs Scribe v2, and Soniox. Update `src/config/model-pricing.ts` with latest values and bump `lastUpdated` date."*
3. Claude делает web searches, обновляет файл
4. `git commit -m "chore: update AI model pricing"` + `git push`
5. Railway автодеплой за 2 минуты

Это занимает у студента ~1 минуту времени и не требует знания кода. Это также **обучающий момент курса** — показать студентам как Claude Code решает рутинные задачи без ручного редактирования.

**Никакого admin UI для редактирования цен не делаем** — для обучающего проекта это лишняя сложность. Hardcoded config + Claude Code update — оптимальный путь.

## Multi-Tenant Architecture & User Roles

Платформа работает по модели **студент-владелец → много тенантов (его клиентов)**. Один Railway-проект обслуживает всех клиентов одного студента. Каждый тенант изолирован: свои разговоры, своя knowledge base, свои API keys, свой WhatsApp канал.

### User Roles

Три уровня доступа в одной таблице `users`:

| Role | Кто это | Что видит и может |
|------|---------|--------------------|
| `super_admin` | Студент (владелец платформы) | **Всё**: список всех тенантов, создание/редактирование/suspension, super-admin метрики (usage по всем тенантам), управление API keys всех клиентов |
| `tenant_admin` | Клиент студента (владелец бизнеса) | **Только свой тенант**: inbox, knowledge base, AI persona, модели, API keys, usage |
| `operator` | (зарезервировано на будущее) | На MVP не используется. Только один `tenant_admin` per tenant. |

**Critical:** На MVP **один пользователь per tenant** — это сам клиент. Множественные операторы на тенант — фича для будущего расширения, не MVP. Это упрощает permissions и UI.

### Database Schema

```typescript
// Table: users
{
  id: uuid (PK)
  email: string (unique)
  password_hash: string
  role: 'super_admin' | 'tenant_admin'
  is_active: boolean
  created_at: timestamp
  last_login_at: timestamp | null
}

// Table: tenants
{
  id: uuid (PK)
  name: string                    // 'Acme Print', 'Acme Weddings'
  status: 'active' | 'suspended' | 'pending_setup'
  owner_user_id: uuid (FK to users)  // tenant_admin для этого тенанта
  ai_persona: text                // editable system prompt (см. AI Persona)
  created_at: timestamp
  suspended_at: timestamp | null
  suspended_reason: string | null
}
```

**Один tenant = один user (owner)**. Email/password принадлежит конкретному тенанту. Если клиент владеет двумя бизнесами — это **два отдельных тенанта** с двумя отдельными аккаунтами.

### Login Flow (единый endpoint для всех ролей)

```typescript
POST /api/auth/login { email, password }
  → находим user в таблице users
  → bcrypt compare password
  → JWT token с { userId, role, tenantId? }
  → редирект:
    - role === 'super_admin' → /admin (super-admin dashboard)
    - role === 'tenant_admin' → /app (tenant inbox)
```

**Tenant isolation middleware:** Для всех роутов под `/api/tenant/*` middleware извлекает `tenantId` из JWT и автоматически инжектит `WHERE tenant_id = ?` во все Prisma-запросы. Это **mandatory** — без него tenant A может случайно прочитать данные tenant B.

```typescript
// Pseudo-code middleware
async function tenantIsolation(req, res, next) {
  if (req.user.role === 'super_admin') {
    // super_admin может видеть все тенанты, но должен явно указать tenantId в query
    req.tenantScope = req.query.tenantId || 'ALL'
  } else {
    // tenant_admin привязан к своему tenantId из JWT
    req.tenantScope = req.user.tenantId
  }
  next()
}
```

### Tenant Suspension (soft suspend)

Когда студент suspend'ит тенанта (например, клиент не заплатил):

1. `tenants.status = 'suspended'` + `suspended_at` + `suspended_reason`
2. **AI перестаёт отвечать** — Baileys сессия отключается
3. **Клиент всё ещё может логиниться** — видит свои разговоры в read-only режиме
4. **Manual reply отключен** — оператор не может отправлять сообщения
5. **Knowledge base read-only** — нельзя загружать новые файлы
6. **API usage не списывается** — никаких AI-вызовов

Когда клиент платит → super_admin reactivates → `status = 'active'` → всё возобновляется.

**Hard delete** тенанта — отдельная операция, требует подтверждения "Type DELETE to confirm". Удаляет все разговоры, knowledge base, API keys.

### Super-Admin Capabilities

В `/admin` панели студент видит:

- **Tenants list:** название, статус, последняя активность, AI usage за месяц, расходы
- **Create tenant:** новый тенант + email/password для клиента
- **Edit tenant:** API keys, модели, AI persona (от имени клиента)
- **Suspend / Reactivate / Delete tenant**
- **Cross-tenant usage:** общие расходы AI по всем клиентам, топ по usage
- **Audit log:** действия super-admin (создание тенантов, изменения keys)

### Tenant-Admin Capabilities (что видит клиент)

В `/app` панели клиент видит:

1. **Inbox** — все разговоры WhatsApp, real-time, manual reply
2. **Knowledge Base** — upload/delete файлов (PDF/DOCX/TXT), индексируются в Gemini File Search
3. **AI Persona** — **editable system prompt** в UI. Текстовое поле где клиент пишет инструкции для AI ("ты менеджер магазина X, отвечай вежливо, продавай услуги Y..."). Без шаблонов, полный контроль.
4. **Model Selection** — Text/Vision/STT с ценами рядом (см. AI Models & Provider Configuration)
5. **API Keys** — view (masked) + edit + reveal для каждого ключа
6. **Usage & Costs** — текущий месяц, график по дням, топ разговоров по стоимости
7. **Channel Status** — WhatsApp connected/disconnected, кнопка переподключения

### AI Persona (Editable System Prompt)

Каждый тенант пишет свой system prompt с нуля в textarea. Никаких wizards/шаблонов — полная гибкость.

```typescript
// Stored in tenants.ai_persona (text, no length limit)
// Example:
"Ты — менеджер свадебного агентства Acme Weddings.
Отвечай дружелюбно, помогай выбрать виньетки для свадьбы.
Рабочие часы: пн-пт 10:00-19:00 (но ты отвечаешь 24/7).
Если клиент спрашивает про цены — используй информацию из базы знаний.
Если клиент хочет говорить с человеком — скажи 'минутку, переключаю на менеджера'."
```

В runtime этот prompt вставляется в начало messages array как `system` message. Knowledge base RAG context подмешивается отдельно.

### Conversations Schema

```typescript
// Table: conversations
{
  id: uuid (PK)
  tenant_id: uuid (FK)
  contact_identifier: string  // phone number (WhatsApp JID)
  contact_name: string | null
  status: 'ai_active' | 'human_active' | 'awaiting_human' | 'resolved'
  // ... rest from manual-reply section
}

// UNIQUE constraint: (tenant_id, contact_identifier)
```

### AI Always-On (24/7)

AI работает **круглосуточно по умолчанию**. Никаких "working hours" логики на MVP. Если клиент хочет ограничить — он указывает это в **AI Persona prompt** ("если время с 22:00 до 8:00 — отвечай что менеджер свяжется утром"). LLM сам решает на основе текущего времени, переданного в context.

В каждый AI-вызов передавать текущее время и timezone тенанта в system message:

```typescript
const systemMessage = `${tenant.ai_persona}

Current time: ${new Date().toLocaleString('ru-RU', { timeZone: tenant.timezone })}
Timezone: ${tenant.timezone}`
```

Это позволяет клиенту через persona prompt контролировать поведение в нерабочие часы без отдельной "working hours" фичи.

## Deployment & Infrastructure

Платформа разворачивается на **Railway** одним проектом с тремя сервисами. Этого достаточно для обслуживания 5-15 тенантов в одной инсталляции.

### Railway Project Structure

```
my-ai-platform (Railway project)
├── web              ← Node.js + Express + React static (один сервис)
├── postgres         ← managed PostgreSQL (one-click add)
└── redis            ← managed Redis (one-click add)
```

**Web service деплоит monorepo:**
- `/backend` — Express API, Baileys, AI logic
- `/frontend` — React app, билдится в `/frontend/dist`
- Express отдаёт `/frontend/dist` как static (один origin, нет CORS)
- Один `npm run build` собирает всё, один деплой обновляет всё

**Не разделять frontend и backend на два Railway-сервиса** — для этого проекта нет смысла, добавляет сложность (CORS, два деплоя, два URL).

### Repository Structure (monorepo)

```
project-root/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── model-pricing.ts   ← hardcoded AI prices
│   │   ├── services/
│   │   ├── routes/
│   │   └── server.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── package.json
├── frontend/
│   ├── src/
│   ├── dist/            ← билд для production (gitignored)
│   ├── vite.config.ts
│   └── package.json
├── package.json         ← root, с workspaces
├── railway.json         ← Railway config
└── CLAUDE.md
```

### Build & Start Commands

```json
// root package.json
{
  "workspaces": ["backend", "frontend"],
  "scripts": {
    "build": "npm run build --workspace=frontend && npm run build --workspace=backend",
    "start": "npm run start --workspace=backend",
    "db:migrate:deploy": "cd backend && npx prisma migrate deploy"
  }
}

// backend/package.json — start script
{
  "scripts": {
    "build": "tsc",
    "start": "npm run db:migrate:deploy && node dist/server.js"
  }
}
```

### Database Migrations (auto-run on deploy)

Migrations запускаются **автоматически** при каждом деплое перед стартом сервера:

```
Railway deploy → npm run build → npm start
                                    ↓
                              prisma migrate deploy
                                    ↓
                              node dist/server.js
```

Если migration падает (ломающее изменение схемы) — Railway не стартует новый сервис, старый продолжает работать. Это safety net.

**Health check:** Railway проверяет `/api/health` endpoint. Endpoint должен вернуть 200 только если БД доступна и migrations прошли:

```typescript
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.status(200).json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'db_unavailable' })
  }
})
```

### Environment Variables

#### Auto-injected by Railway (не трогать руками)

| Variable | Source | Notes |
|----------|--------|-------|
| `DATABASE_URL` | Postgres service | Connection string, auto-injected когда добавляешь Postgres |
| `REDIS_URL` | Redis service | Connection string, auto-injected когда добавляешь Redis |
| `PORT` | Railway | HTTP port для web service |
| `RAILWAY_ENVIRONMENT` | Railway | `production` / `staging` |

#### Manual (студент задаёт в Railway dashboard)

| Variable | Purpose | How to generate |
|----------|---------|-----------------|
| `JWT_SECRET` | JWT signing | `openssl rand -hex 64` (минимум 32 байта) |
| `ENCRYPTION_KEY` | AES-256 для API keys клиентов | `openssl rand -hex 32` (ровно 32 байта) |
| `SUPER_ADMIN_EMAIL` | Bootstrap первого super-admin | Email студента |
| `SUPER_ADMIN_PASSWORD` | Bootstrap пароль (только при первом запуске) | Сложный пароль, потом сменить |
| `APP_URL` | Public URL приложения | `https://yourapp.up.railway.app` или custom domain |

**Per-tenant API keys** (OpenAI, Gemini, Grok, ElevenLabs, Soniox) **не хранятся в env vars** — они в БД зашифрованно (см. AI Models & Provider Configuration → Per-Tenant API Keys).

### Critical: ENCRYPTION_KEY Management

`ENCRYPTION_KEY` — **самый важный секрет** в проекте. Он шифрует API keys всех клиентов.

- **Никогда** не коммитить в git (даже в `.env.example`)
- **Никогда** не логировать
- **Backup отдельно** — записать на бумажку в безопасное место. **Если потеряется — все клиентские API keys в БД станут unrecoverable** (даже бэкап БД не поможет без ключа)
- **Never rotate без миграции** — если хочешь сменить, нужно: расшифровать все keys старым → перешифровать новым → обновить env var. Без этого все ключи "сломаются".

### Bootstrap First Super-Admin

При первом запуске backend проверяет: если в `users` таблице нет записей с `role='super_admin'` — создаёт одного из `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` env vars. После создания эти env vars можно удалить.

```typescript
// На старте сервера
async function bootstrapSuperAdmin() {
  const exists = await prisma.user.findFirst({ where: { role: 'super_admin' } })
  if (!exists && process.env.SUPER_ADMIN_EMAIL) {
    await prisma.user.create({
      data: {
        email: process.env.SUPER_ADMIN_EMAIL,
        password_hash: await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 10),
        role: 'super_admin',
        is_active: true,
      }
    })
    console.log('[bootstrap] Super-admin created. Remove SUPER_ADMIN_PASSWORD env var now.')
  }
}
```

### Backups

**На MVP полагаемся на Railway managed Postgres backups** — они включены в Hobby plan ($5/месяц), делаются автоматически, восстанавливаются через Railway dashboard.

**Что Railway backup НЕ покрывает:**
- Baileys session credentials (если хранятся в filesystem — но мы храним в БД, см. Anti-Ban Patterns)
- `ENCRYPTION_KEY` (это твоя ответственность, бэкап на бумажку/password manager)

**Когда расти:** если у студента >10 тенантов, добавить custom backup job:
- BullMQ scheduled job раз в день
- `pg_dump` → upload в Cloudflare R2 / S3
- Retention 30 дней
- Не делаем на MVP — лишняя сложность.

### Custom Domains

Railway даёт URL вида `myproject.up.railway.app`. Для production у клиента это выглядит непрофессионально. Custom domain (`crm.clientbusiness.com` или `app.studentplatform.com`):

1. В Railway dashboard → Settings → Custom Domain → добавить домен
2. Railway даёт CNAME target (например `xxx.up.railway.app`)
3. У провайдера домена (GoDaddy / Hostinger / Namecheap) добавить CNAME запись
4. Railway автоматически выдаст SSL сертификат через Let's Encrypt

**Рекомендация для студентов:** один master домен типа `app.studentplatform.com` для всей платформы. Не нужно делать subdomain per tenant — это лишняя сложность. Все тенанты логинятся в один URL, разделение по аккаунту.

### Capacity Planning

Railway Hobby plan ($5/месяц) даёт:
- 8 GB RAM на проект
- $5 кредита включено в плату

Реальная capacity:
- **5-10 тенантов** — комфортно на Hobby
- **10-20 тенантов** — может потребоваться Pro plan ($20/месяц)
- **20+ тенантов** — нужно мониторить RAM, может потребоваться разделение Redis/Postgres на отдельные планы

Узкие места: Baileys держит persistent WhatsApp connection per tenant — это RAM. Каждая активная сессия ~50-100 MB. 10 тенантов × 100 MB = 1 GB только на Baileys.

### Logs & Monitoring

- **Railway Logs**: structured JSON через `pino`, видны в Railway dashboard
- **Error tracking**: на MVP не нужно. Если масштабируется — добавить Sentry (free tier хватит)
- **Uptime monitoring**: BetterStack / UptimeRobot (free tier) — пинговать `/api/health` раз в минуту

### Deployment Checklist (для студента при первом запуске)

1. ☐ Создать Railway project, добавить Postgres + Redis
2. ☐ Сгенерировать `JWT_SECRET` через `openssl rand -hex 64`
3. ☐ Сгенерировать `ENCRYPTION_KEY` через `openssl rand -hex 32`, сохранить отдельно
4. ☐ Установить все env vars в Railway dashboard
5. ☐ Connect GitHub repo → Railway автодеплой
6. ☐ Дождаться первого деплоя, проверить `/api/health`
7. ☐ Залогиниться как super-admin
8. ☐ **Удалить `SUPER_ADMIN_PASSWORD` env var**
9. ☐ Опционально: настроить custom domain
10. ☐ Создать первого тенанта (своего тестового) → проверить весь flow

## Tenant Onboarding Flow

Onboarding нового тенанта — это процесс который запускает **студент (super_admin)** через `/admin` панель. UI построен как **dashboard с чек-листом** (8 шагов), студент может заполнять в любом порядке и продолжать с прерывания.

### Flow Type: Checklist Dashboard (not wizard)

Не делать линейный wizard "Step 1 → Step 2 → Step 3". Делать checklist:

```
┌─ Onboarding: Acme Cafe ────────────────────────┐
│ Status: pending_setup                          │
│ Progress: 5 / 7 steps                          │
│                                                │
│ ✅ 1. Tenant Info        (name, contact email) │
│ ✅ 2. Login Credentials  (email + password)    │
│ ✅ 3. API Keys           (Gemini + 1 text key) │
│ ✅ 4. AI Models Selected (Text/Vision/STT)     │
│ ✅ 5. AI Persona Written (system prompt)       │
│ ⚪ 6. WhatsApp Connection (QR scan)            │
│ ⚪ 7. Knowledge Base (optional, upload files)  │
│                                                │
│ [ Activate Tenant ] (disabled until 6 done)   │
└────────────────────────────────────────────────┘
```

**Минимум для активации:** шаги 1-6. Knowledge base (7) опционален — клиент может добавить позже.

### Step 1: Tenant Info

- Business name (отображается в админке клиента, в WhatsApp profile)
- Contact email (клиента, для связи)
- Timezone (для AI persona current time context)
- Industry / тип бизнеса (опционально, для аналитики студента)

### Step 2: Login Credentials

- Email клиента (будет логином)
- Temporary password (студент придумывает, потом передаёт клиенту)
- Force password change on first login: **yes** (обязательная смена при первом логине)

### Step 3: API Keys

Форма с 5 полями:

| Field | Required | Notes |
|-------|----------|-------|
| Gemini API key | **Yes** (всегда) | Нужен для RAG. Даже если text/vision модели — другие. |
| OpenAI API key | If chosen | Только если выбран OpenAI для text или vision |
| xAI (Grok) API key | If chosen | Только если выбран Grok для text |
| ElevenLabs API key | If chosen | Только если выбран ElevenLabs для STT |
| Soniox API key | If chosen | Только если выбран Soniox для STT |

Все ключи шифруются AES-256-GCM перед записью в БД. UI показывает masked версию (`sk-...XXXX`).

### Step 4: AI Model Selection

Три селектора (Text / Vision / STT) с ценами рядом (см. AI Models & Provider Configuration → Pricing Display in UI).

Студент выбирает дефолтные модели за клиента. Клиент потом сам может менять в своей админке.

### Step 5: AI Persona

**Editable textarea**, без шаблонов. Студент пишет system prompt с нуля под бизнес клиента, или копипастит готовый.

```
┌─ AI Persona (System Prompt) ───────────────────┐
│ ┌────────────────────────────────────────────┐ │
│ │ Ты — менеджер кафе "Acme Cafe".            │ │
│ │ Отвечай дружелюбно, на русском или         │ │
│ │ казахском (зависит от языка клиента).      │ │
│ │ Часы работы: 8:00-22:00.                   │ │
│ │ Если клиент хочет забронировать столик —   │ │
│ │ спроси количество гостей и время.          │ │
│ │ ...                                        │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ [Save Draft]  [Test with sample message]      │
└────────────────────────────────────────────────┘
```

Кнопка "Test with sample message" — отправляет тестовое сообщение в выбранную text model с этим persona, показывает ответ. Помогает студенту проверить prompt без подключения WhatsApp.

### Step 6: WhatsApp Connection (QR Scan)

Самый сложный шаг. Должен поддерживать **оба сценария**:

**Сценарий A: студент сканирует на клиентском телефоне (личная встреча или screen share)**
- UI показывает **fullscreen QR** (большая кнопка "Show fullscreen")
- Кнопка "Refresh QR" если истёк
- Status indicator "Waiting for scan..." → "Connected" → автоматически переходит к шагу 7

**Сценарий B: клиент сам сканирует у себя**
- UI имеет кнопку "Send QR to client via email"
- Email содержит ссылку на secure-страницу (одноразовый token, действует 1 час)
- Клиент открывает на любом устройстве, видит QR, сканирует с телефона где WhatsApp

**Important UX:** показывать **анимацию** или большой текст "Waiting for WhatsApp to connect..." с реальным countdown. Клиенты-нетехнари часто не понимают что делать после сканирования — нужна обратная связь.

```typescript
// Backend: Baileys connection status events
sock.ev.on('connection.update', (update) => {
  io.to(`tenant-${tenantId}`).emit('whatsapp:status', {
    status: update.connection, // 'open' | 'connecting' | 'close'
    qr: update.qr || null
  })
})
```

После успешного коннекта — сохранить creds в БД (зашифрованно), перейти к шагу 7.

### Step 7: Knowledge Base Upload

Drag-and-drop area для файлов:

- Supported: PDF, DOCX, TXT (валидация по mime type + extension)
- **No size limit** (Gemini File Search storage бесплатный)
- При загрузке: файл → Gemini File Search API через `tenant.gemini_key` → возвращается `corpus_id`
- Сохраняется ссылка в `tenant_knowledge_files` таблице

```typescript
// Table: tenant_knowledge_files
{
  id: uuid (PK)
  tenant_id: uuid (FK)
  filename: string
  file_size_bytes: int
  gemini_file_id: string         // returned by Gemini File Search
  gemini_corpus_id: string       // tenant's corpus
  uploaded_at: timestamp
  uploaded_by: uuid (user_id)
}
```

UI показывает список загруженных файлов с возможностью удалить. Удаление = DELETE в Gemini File Search + удалить запись в БД.

**Этот шаг опциональный** — клиент может работать без knowledge base (AI отвечает только на основе persona prompt). Может загрузить файлы позже из своей админки.

### Activation

После того как шаги 1-6 заполнены, кнопка "Activate Tenant" становится активной:

1. `tenants.status = 'active'`
2. Запуск Baileys WhatsApp listener для этого тенанта
3. Email клиенту с инструкциями: "Your AI assistant is now active. Login at https://app.studentplatform.com with email X"
4. Email содержит инструкцию обязательно сменить пароль при первом логине

### Post-Activation: Client First Login

Когда клиент логинится впервые:

1. Forced password change screen
2. Краткий tour (3-5 шагов): "Это ваш inbox", "Здесь модели", "Здесь knowledge base"
3. Опциональный quick test: "Send a test message to your WhatsApp from another phone to see how AI replies"

Это снижает confusion для нетехнических клиентов и ускоряет adoption.

### Re-onboarding (когда что-то ломается)

Студент должен иметь возможность перезапустить любой шаг:

- WhatsApp disconnected (бан, logout) → "Re-scan QR" в admin UI тенанта
- API key invalidated → "Update API key" в settings

Все эти операции доступны из tenant settings page в `/admin`, не требуют полного re-onboarding.

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.

