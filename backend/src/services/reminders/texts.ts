import type { Lang } from '../sheets/language.js';
import type { ReminderStage } from './time.js';

const DEFAULTS: Record<ReminderStage, Record<Lang, string>> = {
  '10h': {
    ru: 'Напоминаем: вы записаны на консультацию {date} в {time}. Ждём вас!',
    kk: 'Еске саламыз: сіз {date} күні сағат {time}-ге консультацияға жазылғансыз. Күтеміз!',
  },
  '1h': {
    ru: 'Напоминаем: через час, в {time}, у вас консультация. Ждём вас!',
    kk: 'Еске саламыз: бір сағаттан кейін, сағат {time}-де, консультацияңыз бар. Күтеміз!',
  },
};

/** The built-in text with its `{date}` and `{time}` placeholders. */
export function defaultReminderText(stage: ReminderStage, lang: Lang): string {
  return DEFAULTS[stage][lang];
}

/** The tenant's custom text if it has one, else the default; `{date}` becomes dd.mm and `{time}` HH:mm. */
export function reminderText(
  stage: ReminderStage,
  lang: Lang,
  b: { date: string; time: string },
  custom?: string | null,
): string {
  const template = custom && custom.trim() ? custom : defaultReminderText(stage, lang);
  const date = `${b.date.slice(8)}.${b.date.slice(5, 7)}`;
  return template.replaceAll('{date}', date).replaceAll('{time}', b.time);
}
