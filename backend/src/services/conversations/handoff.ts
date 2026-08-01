const HANDOFF_KEYWORDS = [
  // Операторға / менеджерге жалғау (орысша)
  'оператор',
  'менеджер',
  'живой человек',
  'живого человека',
  'соедините с',
  'переключите на',
  'нужен человек',
  // Шағым / қайтару
  'жалоба',
  'возврат',
  'претензия',
  'юрист',
  // Қазақша
  'менеджер керек',
  'оператор керек',
  'адаммен сөйлесу',
  'тірі адам',
  // Ағылшынша
  'manager',
  'operator',
  'complaint',
  'refund',
];

// Whole-word patterns to avoid substring false-positives (e.g. 'inhumane', 'humanitarian')
const HANDOFF_WORD_PATTERNS = [/\bhuman\b/];

export function shouldHandoff(text: string, aiConfidence?: number): { handoff: boolean; reason?: string } {
  const lower = text.toLowerCase();
  for (const kw of HANDOFF_KEYWORDS) {
    if (lower.includes(kw)) return { handoff: true, reason: `keyword: ${kw}` };
  }
  for (const re of HANDOFF_WORD_PATTERNS) {
    if (re.test(lower)) return { handoff: true, reason: `keyword: ${re.source}` };
  }
  if (aiConfidence != null && aiConfidence < 0.4) {
    return { handoff: true, reason: `low_confidence: ${aiConfidence.toFixed(2)}` };
  }
  return { handoff: false };
}
