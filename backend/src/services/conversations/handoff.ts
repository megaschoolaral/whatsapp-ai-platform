const HANDOFF_KEYWORDS = [
  'оператор',
  'менеджер',
  'человек',
  'живой человек',
  'жалоба',
  'возврат',
  'претензия',
  'юрист',
  'manager',
  'operator',
  'human',
  'complaint',
  'refund',
];

export function shouldHandoff(text: string, aiConfidence?: number): { handoff: boolean; reason?: string } {
  const lower = text.toLowerCase();
  for (const kw of HANDOFF_KEYWORDS) {
    if (lower.includes(kw)) return { handoff: true, reason: `keyword: ${kw}` };
  }
  if (aiConfidence != null && aiConfidence < 0.4) {
    return { handoff: true, reason: `low_confidence: ${aiConfidence.toFixed(2)}` };
  }
  return { handoff: false };
}
