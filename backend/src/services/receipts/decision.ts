export type ReceiptOutcome = { kind: 'ok' } | { kind: 'underpaid'; missing: number };

function formatTenge(amount: number): string {
  return amount.toLocaleString('ru-RU');
}

export function decideOutcome(amount: number, minAmount: number | null): ReceiptOutcome {
  if (minAmount !== null && amount < minAmount) {
    return { kind: 'underpaid', missing: minAmount - amount };
  }
  return { kind: 'ok' };
}

export function buildClientReply(outcome: ReceiptOutcome): string {
  if (outcome.kind === 'ok') {
    return 'Чек қабылданды, жақын арада сізге хабарласады.\nЧек принят, в ближайшее время с вами свяжутся.';
  }
  const missing = formatTenge(outcome.missing);
  return (
    `Төлем сомасы жеткіліксіз, қалған ${missing} ₸ төлеңіз. Жақын арада сізге байланысқа шығады.\n` +
    `Сумма оплаты недостаточна, доплатите оставшиеся ${missing} ₸. В ближайшее время с вами свяжутся.`
  );
}

export function buildTelegramText(a: {
  clientName: string | null;
  phone: string | null;
  amount: number;
  iinMismatch: boolean;
}): string {
  const name = a.clientName?.trim() || 'Аты белгісіз';
  const phone = a.phone ?? 'нөмір белгісіз';
  const line = `${name}, ${phone}, ${formatTenge(a.amount)} ₸ төледі`;
  return a.iinMismatch ? `${line}\n⚠️ ИИН сәйкес емес` : line;
}

/** Phone number from a WhatsApp jid; `@lid` ids carry no number, so fall back to the alternative phone jid. */
export function phoneFromJid(jid: string, jidAlt?: string | null): string | null {
  for (const candidate of [jid, jidAlt]) {
    if (candidate?.endsWith('@s.whatsapp.net')) return candidate.split('@')[0]!.split(':')[0]!;
  }
  return null;
}
