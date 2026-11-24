# Kaspi чек тексеру — іске асыру жоспары

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Тенант WhatsApp-қа Kaspi чегін (PDF/сурет) жібергенде, жүйе QR арқылы чекті оқып, тенанттың Telegram арнасына хабарлама жібереді және клиентке жауап береді; функция әр тенантқа админ панельден қосылып-өшіріледі.

**Architecture:** `inbound.ts` ішінде, AI буферіне дейін, функция қосулы тенантта PDF/сурет `receiptProcessor` арқылы өтеді: QR оқу → Kaspi бетін алу → `__NUXT_DATA__` парсинг → шешім (сома жеткілікті/жетпейді) → Telegram + WhatsApp жауабы → сөйлесу `awaiting_human`. QR жоқ болса, хабарлама бұрынғыша AI-ға кетеді. Баптаулар жеке кестеде, токен AES-GCM-мен шифрленген.

**Tech Stack:** Node/Express/Prisma/Baileys (бар), жаңасы: `jsqr`, `pdf-to-img`, `pngjs` (`sharp` бар), `vitest` (dev). Telegram — тікелей Bot API `fetch`.

**Spec:** осы чаттағы келісім + `/Users/ajbekzaksybaev/Desktop/Клауд документ/каспи парсер/` (3 құжат). Бөлек дизайн құжаты жоқ.

## Global Constraints

- Барлық тенант-кестелерінде сұраныс `tenantId` бойынша сүзіледі.
- Telegram токені `crypto/aesGcm.ts` `encrypt/decrypt` арқылы ғана сақталады; API жауабында `maskKey` көрінісі ғана.
- PDF рендер: `pdf-to-img`, `scale: 3` (аз болса QR оқылмайды); `pdf-to-img` ESM-only → `await import('pdf-to-img')`.
- Парсер индекстерді қатты жазбайды: `amount` және `extTranId` бар объектіні іздейді; мәндер `resolve()` арқылы.
- QR URL тек `https` және хост `kaspi.kz` немесе `*.kaspi.kz` (нақты хост тексеру, `includes` емес).
- Клиентке жауап мәтіні: қазақша, орысша аудармасы қатар. Жетпесе: «қалған сомасын төлеңіз» + «жақын арада сізге байланысқа шығады». Екі жағдайда да сөйлесу `awaiting_human`.
- Telegram мәтіні: `Клиент аты, телефон, <сома> ₸ төледі`; жетпесе де белгісіз, нақты сома.
- Чек өңдеу бір мезгілде тек біреу (жад үнемдеу).
- Функция қосқышы өшіру кезінде ешқандай мінез-құлық өзгермейді.

## Review Focus

1. Чек QR-ы `https://evil.com/kaspi.kz` немесе `kaspi.kz.evil.com` — сұраныс жіберілмейді, «чек емес» деп AI-ға кетеді (T2).
2. Бір чек екі рет (не бір мезгілде екі хабарлама) — Telegram бір рет, клиентке екінші рет «қабылданды» (T6).
3. Көп беттік PDF, QR 2-бетте (T3, қолмен).
4. Kaspi беті 200 емес/`__NUXT_DATA__` жоқ — клиентке «қайта жіберіңіз», Telegram-ға ештеңе (T6).
5. Клиент нөмірі `@lid` форматында — телефон белгісіз болса, хабарламада «нөмір белгісіз» (T1).

---

### Task 1: Тест құралы және шешім логикасы

**Files:**
- Modify: `backend/package.json` (`vitest` devDependency, `"test": "vitest run"`)
- Create: `backend/src/services/receipts/decision.ts`
- Test: `backend/src/services/receipts/decision.test.ts`

**Interfaces:**
- Produces: `type ReceiptOutcome = { kind: 'ok' } | { kind: 'underpaid'; missing: number }`; `decideOutcome(amount: number, minAmount: number | null): ReceiptOutcome`; `buildClientReply(outcome: ReceiptOutcome): string`; `buildTelegramText(a: { clientName: string | null; phone: string | null; amount: number; iinMismatch: boolean }): string`; `phoneFromJid(jid: string, jidAlt?: string | null): string | null`.

- [ ] **Step 1: Failing tests** (`decision.test.ts`): `decideOutcome(10000, 10000)` → `ok`; `decideOutcome(7000, 10000)` → `{underpaid, missing: 3000}`; `decideOutcome(5000, null)` → `ok`; `buildClientReply(underpaid 3000)` сомасында `3 000` және `жақын арада` бар; `buildTelegramText` `10 000 ₸ төледі`, `iinMismatch:true` болса «ИИН сәйкес емес» белгісі, `phone:null` болса «нөмір белгісіз»; `phoneFromJid('77071110354@s.whatsapp.net')` → `77071110354`; `@lid` + alt жоқ → `null`; `@lid` + alt `…@s.whatsapp.net` → alt нөмірі.
- [ ] **Step 2:** `npm run test --workspace=backend` → FAIL (модуль жоқ).
- [ ] **Step 3:** Жоғарыдағы сигнатуралармен іске асыру; сомалар `toLocaleString('ru-RU')`.
- [ ] **Step 4:** тест → PASS.
- [ ] **Step 5:** commit `feat(receipts): decision logic and message builders`.

### Task 2: Kaspi беті парсері

**Files:**
- Create: `backend/src/services/receipts/kaspiParser.ts`
- Test: `backend/src/services/receipts/kaspiParser.test.ts`, фикстура `backend/src/services/receipts/__fixtures__/nuxt-data.json`

**Interfaces:**
- Produces: `interface KaspiReceipt { receiptId: string; amount: number; sellerIin: string; sellerName: string | null; clientIin: string | null; paymentMethod: string | null; datetime: string | null }`; `isKaspiUrl(url: string): boolean`; `parseNuxtData(nuxt: unknown[]): KaspiReceipt`; `fetchKaspiReceipt(qrUrl: string): Promise<KaspiReceipt>`.

- [ ] **Step 1: Failing tests:** `isKaspiUrl` — `https://pay.kaspi.kz/x` true; `https://evil.com/kaspi.kz`, `https://kaspi.kz.evil.com`, `http://kaspi.kz/x` false; `parseNuxtData(fixture)` индекстік сілтемелері бар массивте `receiptId`, `amount` (число), `sellerIin` қайтарады; `amount`/`extTranId` объектісі жоқ болса throw.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `каспи парсер.docx` логикасын TypeScript-ке көшіру (`resolve`, `findDataObject`, `findFieldValue`). Белгілер: `ИИН/БИН продавца`, `Оплачено`, `Дата и время` (құжаттағы кодтау бұзылған, нақты Kaspi бетімен салыстыру керек). `fetchKaspiReceipt`: алдымен `isKaspiUrl`, `redirect:'follow'` соң `res.url` хосты да тексеріледі, `User-Agent: Mozilla/5.0`, timeout 10 с. `sellerName` бетте табылмаса `null`. Фикстураны шынайы чектен жасау (T9-дан кейін толықтырылады; алдымен құжаттағы құрылымнан синтетикалық).
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(receipts): Kaspi page parser`.

### Task 3: QR оқу

**Files:**
- Modify: `backend/package.json` (`jsqr`, `pdf-to-img`, `pngjs`, `@types/pngjs`; dev: `qrcode`)
- Create: `backend/src/services/receipts/qr.ts`
- Test: `backend/src/services/receipts/qr.test.ts`

**Interfaces:**
- Produces: `readQrUrl(buf: Buffer, mimeType: string): Promise<string | null>` — PDF үшін `pdf-to-img` scale 3 барлық беттер, сурет үшін `sharp().ensureAlpha().raw()`; қате/QR жоқ → `null` (қате лақтырмайды).

- [ ] **Step 1: Failing test:** `qrcode` пакетімен `https://pay.kaspi.kz/test` PNG жасап, `readQrUrl(png,'image/png')` оны қайтарады; QR жоқ сурет → `null`; жарамсыз buffer → `null`.
- [ ] **Step 2:** FAIL. **Step 3:** іске асыру. **Step 4:** PASS.
- [ ] **Step 5:** PDF жолы автотестсіз: T9-да шынайы PDF-пен қолмен тексеріледі. Commit `feat(receipts): QR reader for photos and PDFs`.

### Task 4: DB және баптау қызметі

**Files:**
- Modify: `backend/prisma/schema.prisma` (`TenantReceiptSettings`, `Receipt`, `Tenant` қатынасы)
- Create: `backend/prisma/migrations/20261027120000_receipt_check/migration.sql`, `backend/src/services/receipts/settings.ts`
- Test: `backend/src/services/receipts/settings.test.ts` (тек таза валидация)

**Interfaces:**
- Produces: `model TenantReceiptSettings { tenantId @id, enabled Boolean @default(false), sellerIin String?, minAmount Int?, telegramBotTokenEnc String?, telegramChatId String?, updatedAt }`; `model Receipt { id, tenantId, receiptId, amount Int, sellerIin, paymentMethod?, qrUrl, conversationId, createdAt, @@unique([tenantId, receiptId]) }`; `interface ReceiptSettings { enabled; sellerIin: string; minAmount: number | null; telegramBotToken: string; telegramChatId: string }`; `loadActiveReceiptSettings(tenantId: string): Promise<ReceiptSettings | null>` (өшірулі/толық емес → `null`); `validateEnable(input: { sellerIin?: string|null; telegramBotToken?: string|null; telegramChatId?: string|null }): string | null` (қате мәтіні немесе `null`).

- [ ] **Step 1:** `validateEnable` тесті: үш өріс толық → `null`; біреуі бос → қате мәтіні; `sellerIin` 12 саннан тұрмаса → қате.
- [ ] **Step 2–4:** FAIL → іске асыру → PASS. Миграция SQL қолмен (алдыңғы `saved_contacts` стилінде), `npx prisma generate`, `npx tsc --noEmit` таза.
- [ ] **Step 5:** commit `feat(receipts): settings and receipt tables`.

### Task 5: Telegram жіберуші

**Files:**
- Create: `backend/src/services/receipts/telegram.ts`
- Test: `backend/src/services/receipts/telegram.test.ts`

**Interfaces:**
- Produces: `sendTelegramMessage(a: { botToken: string; chatId: string; text: string }): Promise<void>` — `POST https://api.telegram.org/bot<token>/sendMessage`, `ok:false` немесе HTTP қате болса `throw`, қате мәтінінде токен жоқ.

- [ ] **Step 1: Failing tests** (`fetch` mock): сәтті жағдайда дұрыс URL/body; `ok:false` → throw; throw мәтінінде токен көрінбейді.
- [ ] **Step 2–4:** FAIL → іске асыру → PASS. **Step 5:** commit `feat(receipts): Telegram sender`.

### Task 6: Өңдеуші және `inbound.ts` қосылымы

**Files:**
- Create: `backend/src/services/receipts/processor.ts`
- Modify: `backend/src/services/whatsapp/inbound.ts` (медиа буферін сақтау, AI буферінен бұрын чек тексеру)
- Test: `backend/src/services/receipts/processor.test.ts` (Prisma/fetch/telegram mock)

**Interfaces:**
- Consumes: T1–T5.
- Produces: `handleReceiptMessage(a: { tenantId: string; sock: Sock; jid: string; jidAlt?: string | null; conversationId: string; contactName: string | null; buf: Buffer; mimeType: string; settings: ReceiptSettings }): Promise<'handled' | 'not_receipt'>`.

- [ ] **Step 1: Failing tests:** QR жоқ → `not_receipt`, ештеңе жіберілмейді; сәтті чек, сома жеткілікті → `Receipt` жазылады, Telegram бір рет, клиентке «қабылданды» жауабы, `awaiting_human`; сома жетпейді → Telegram нақты сомамен, клиентке «қалған N ₸»; қайталанған `receiptId` → Telegram жоқ, клиентке жауап бар; парсер қатесі → клиентке «қайта жіберіңіз», Telegram жоқ; `sellerIin` сәйкес емес → Telegram-ға белгімен жіберіледі; екі қатар шақыру бір-бірін күтеді.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Іске асыру. Бір мезгілде бір өңдеу (модульдегі promise тізбегі). Қайталануды `Receipt` `@@unique` ұстап қалады (P2002 → қайталау). Клиентке жауап `sendHumanLikeText` арқылы. Telegram қатесі болса, клиентке жауап бәрібір жіберіледі және қате логқа жазылады. `inbound.ts`: `downloadMedia` нәтижесін сыртқы айнымалыға алу; `saved` анықталғаннан кейін және `appendToBuffer` алдында: `!saved && (image | pdf document) && settings` болса `handleReceiptMessage`; `handled` болса `unreadCount` көтеріп `return`.
- [ ] **Step 4:** PASS, `tsc --noEmit` таза. **Step 5:** commit `feat(receipts): receipt processor wired into inbound`.

### Task 7: Админ API

**Files:**
- Create: `backend/src/routes/admin/tenantReceiptCheck.ts`
- Modify: `backend/src/server.ts` (`/api/admin/tenants/:tenantId/receipt-check`)

**Interfaces:**
- Produces: `GET /` → `{ enabled, sellerIin, minAmount, telegramBotToken: <masked>|null, telegramChatId }`; `PUT /` body `{ enabled?, sellerIin?, minAmount?, telegramBotToken?, telegramChatId? }` — `enabled:true` болса `validateEnable` өтуі керек, әйтпесе 400; токен бос жіберілсе ескісі сақталады.

- [ ] **Step 1:** `tenantKeys.ts` үлгісімен (`requireAuth`, `requireRole('super_admin')`, `maskKey`) жазу; `tsc --noEmit` таза.
- [ ] **Step 2:** қолмен `curl` тексеру: толық емес баптаумен қосу → 400; толықпен → 200; GET-те токен маскаланған.
- [ ] **Step 3:** commit `feat(receipts): admin API for receipt check settings`.

### Task 8: Админ панель UI

**Files:**
- Create: `frontend/src/pages/admin/steps/StepReceiptCheck.tsx`
- Modify: `frontend/src/pages/admin/OnboardingChecklistPage.tsx` (бөлімді қосу, міндетті қадамдар тізіміне **қоспау**)

**Interfaces:**
- Consumes: T7 API. Үлгі: `StepFollowups.tsx`.

- [ ] **Step 1:** «Чек тексеру» бөлімі: қосқыш, ИИН, ең төмен сома (міндетті емес), бот токені (маска), арна ID, «Сақтау»; қате (400) мәтіні көрсетіледі.
- [ ] **Step 2:** `npm run build --workspace=frontend` қатесіз. **Step 3:** браузерде қолмен тексеру. **Step 4:** commit `feat(receipts): receipt check section in tenant admin`.

### Task 9: Шынайы чекпен тексеру және деплой

- [ ] **Step 1:** Пайдаланушыдан бір шынайы Kaspi чегі (PDF) алу; `parseNuxtData` фикстурасын сол беттен жаңарту; `Дата и время`/`Оплачено`/`ИИН/БИН продавца` белгілері мен ИП атының бар-жоғын растау.
- [ ] **Step 2:** Тест тенантында Telegram бот/арна жасап, қосқышты қосу; WhatsApp-пен PDF жіберу: жеткілікті сома, жетпейтін сома, қайталау, QR-сыз PDF.
- [ ] **Step 3:** `npm run test --workspace=backend`, `npm run build` — жасыл. Жад өлшемі: PDF жібергенде Railway Memory графигінде секіріс бар-жоғын қарау.
- [ ] **Step 4:** Пайдаланушыдан рұқсат алып, `no-calendar` бұтағына push → деплой.

---

## Өзін-өзі тексеру

- Талаптар: қосқыш (T7/T8), тенантқа бөлек Telegram (T4/T5/T7), чек оқу (T2/T3), сома жеткілікті/жетпейтін жауап (T1/T6), қайталау (T4/T6), `awaiting_human` (T6), SSRF қорғау (T2) қамтылған.
- Бос жерлер: ИП аты Kaspi бетінде бар ма, әлі белгісіз (T2, T9 расталады); `@lid` нөмірі (T1).
- Бастапқы құжаттағы `url.includes('kaspi.kz')` тексеруі әдейі нақты хост тексеруімен ауыстырылды.
