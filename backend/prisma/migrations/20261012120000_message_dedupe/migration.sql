-- Remove duplicate inbound messages (same WhatsApp message id stored more than once in a conversation).
-- Keep one row per (conversationId, whatsappMsgId): prefer a row that has text, then the earliest.
DELETE FROM "Message"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "conversationId", "whatsappMsgId"
             ORDER BY (COALESCE(NULLIF("content", ''), NULLIF("transcribedText", '')) IS NULL), "createdAt", id
           ) AS rn
    FROM "Message"
    WHERE "whatsappMsgId" IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- NULL whatsappMsgId (outgoing messages) stays unconstrained: Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX "Message_conversationId_whatsappMsgId_key" ON "Message"("conversationId", "whatsappMsgId");
