import { prisma } from '../../prisma.js';
import { decrypt } from '../../crypto/aesGcm.js';

export interface ReceiptSettings {
  sellerIin: string;
  minAmount: number | null;
  telegramBotToken: string;
  telegramChatId: string;
}

/** Settings of a tenant whose receipt check is on and fully configured; otherwise `null` (feature off). */
export async function loadActiveReceiptSettings(tenantId: string): Promise<ReceiptSettings | null> {
  const row = await prisma.tenantReceiptSettings.findUnique({ where: { tenantId } });
  if (!row?.enabled || !row.sellerIin || !row.telegramBotTokenEnc || !row.telegramChatId) return null;
  try {
    return {
      sellerIin: row.sellerIin,
      minAmount: row.minAmount,
      telegramBotToken: decrypt(row.telegramBotTokenEnc),
      telegramChatId: row.telegramChatId,
    };
  } catch {
    return null;
  }
}
