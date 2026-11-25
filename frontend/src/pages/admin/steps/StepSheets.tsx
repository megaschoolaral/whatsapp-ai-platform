import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SheetsSettings {
  enabled: boolean;
  spreadsheetId: string | null;
  sheetName: string | null;
  daysAhead: number;
  remindersEnabled: boolean;
  reminderTexts: ReminderTexts;
  reminderDefaults: { '10h': { ru: string; kk: string }; '1h': { ru: string; kk: string } };
  /** The platform's service account: the tenant shares the sheet with this email. Null when the platform key is not set. */
  serviceAccountEmail: string | null;
}

type ReminderTexts = { '10h': { ru: string | null; kk: string | null }; '1h': { ru: string | null; kk: string | null } };
type FieldKey = '10h.ru' | '10h.kk' | '1h.ru' | '1h.kk';
const FIELDS: Array<{ key: FieldKey; label: string }> = [
  { key: '10h.ru', label: '10 сағат бұрын — Русский' },
  { key: '10h.kk', label: '10 сағат бұрын — Қазақша' },
  { key: '1h.ru', label: '1 сағат бұрын — Русский' },
  { key: '1h.kk', label: '1 сағат бұрын — Қазақша' },
];
const splitKey = (k: FieldKey) => k.split('.') as ['10h' | '1h', 'ru' | 'kk'];

type CheckResult = { ok: true; freeSlots: number; days: number } | { ok: false; error: string };

export function StepSheets({ tenantId }: { tenantId: string }) {
  const base = `/admin/tenants/${tenantId}/sheets`;
  const [settings, setSettings] = useState<SheetsSettings | null>(null);
  const [spreadsheet, setSpreadsheet] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [daysAhead, setDaysAhead] = useState('7');
  const [loading, setLoading] = useState(false);
  const [texts, setTexts] = useState<Record<FieldKey, string>>({ '10h.ru': '', '10h.kk': '', '1h.ru': '', '1h.kk': '' });

  const apply = (s: SheetsSettings) => {
    setSettings(s);
    setSpreadsheet(s.spreadsheetId ?? '');
    setSheetName(s.sheetName ?? '');
    setDaysAhead(String(s.daysAhead));
    // A text the tenant never changed shows the built-in default, so it can be read and edited in place.
    const next = {} as Record<FieldKey, string>;
    for (const { key } of FIELDS) {
      const [stage, lang] = splitKey(key);
      next[key] = s.reminderTexts[stage][lang] ?? s.reminderDefaults[stage][lang];
    }
    setTexts(next);
  };

  useEffect(() => {
    apiRequest<SheetsSettings>(base)
      .then(apply)
      .catch((err) => toast.error((err as Error).message));
  }, [base]);

  const save = async (enabled: boolean): Promise<boolean> => {
    try {
      apply(
        await apiRequest<SheetsSettings>(base, {
          method: 'PUT',
          body: { enabled, spreadsheet, sheetName, daysAhead: Number(daysAhead) || 7 },
        }),
      );
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };

  const onSave = async (enabled: boolean) => {
    setLoading(true);
    if (await save(enabled)) toast.success(enabled ? 'Google Sheets қосулы' : 'Сақталды');
    setLoading(false);
  };

  const onCheck = async () => {
    if (!settings) return;
    setLoading(true);
    // The check reads the saved settings, so save the current form first.
    if (await save(settings.enabled)) {
      try {
        const res = await apiRequest<CheckResult>(`${base}/check`, { method: 'POST' });
        if (res.ok) toast.success(`Қосылды. Бос слот: ${res.freeSlots}, күн: ${res.days}`);
        else toast.error(res.error);
      } catch (err) {
        toast.error((err as Error).message);
      }
    }
    setLoading(false);
  };

  /** Saves the reminder switch and texts. A text equal to the default is sent as empty so it keeps following the default. */
  const saveReminders = async (remindersEnabled: boolean) => {
    if (!settings) return;
    setLoading(true);
    const reminderTexts = { '10h': {}, '1h': {} } as Record<'10h' | '1h', Record<'ru' | 'kk', string>>;
    for (const { key } of FIELDS) {
      const [stage, lang] = splitKey(key);
      reminderTexts[stage][lang] = texts[key].trim() === settings.reminderDefaults[stage][lang] ? '' : texts[key];
    }
    try {
      apply(await apiRequest<SheetsSettings>(base, { method: 'PUT', body: { remindersEnabled, reminderTexts } }));
      toast.success(remindersEnabled ? 'Еске салу қосулы' : 'Сақталды');
    } catch (err) {
      toast.error((err as Error).message);
    }
    setLoading(false);
  };

  const copyEmail = async () => {
    if (!settings?.serviceAccountEmail) return;
    await navigator.clipboard.writeText(settings.serviceAccountEmail);
    toast.success('Көшірілді');
  };

  if (!settings) return <div className="text-slate-500">Загрузка...</div>;
  const unavailable = !settings.serviceAccountEmail;

  return (
    <div className="space-y-4">
      {unavailable ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          Платформада Google service account бапталмаған. Railway-ге GOOGLE_SERVICE_ACCOUNT_JSON айнымалысын қосыңыз.
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="font-medium">{settings.enabled ? 'Қосулы' : 'Өшірулі'}</div>
          <div className="text-sm text-slate-500">
            Қосулы болса, AI менеджер кестеден бос уақытты көріп, клиентті сол жерге жазады.
          </div>
        </div>
        <Button
          variant={settings.enabled ? 'outline' : 'default'}
          disabled={loading || (unavailable && !settings.enabled)}
          onClick={() => onSave(!settings.enabled)}
        >
          {settings.enabled ? 'Өшіру' : 'Қосу'}
        </Button>
      </div>

      {settings.serviceAccountEmail ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <div>Кестені мына email-ге «Редактор» ретінде бөлісіңіз:</div>
          <div className="flex items-center gap-2">
            <code className="break-all rounded bg-slate-100 px-2 py-1">{settings.serviceAccountEmail}</code>
            <Button type="button" variant="outline" size="sm" onClick={copyEmail}>
              Көшіру
            </Button>
          </div>
          <div className="text-slate-500">
            «записал» және «источник» бағандарының dropdown тізіміне <b>AI</b> және <b>WhatsApp</b> мәндерін қосыңыз.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2 sm:col-span-2">
          <Label>Google Sheets сілтемесі (немесе ID)</Label>
          <Input
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={spreadsheet}
            onChange={(e) => setSpreadsheet(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Парақ аты (барлық күндер тұрған)</Label>
          <Input placeholder="Ноябрь" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Неше күн алға қарайды</Label>
          <Input type="number" min={1} max={30} value={daysAhead} onChange={(e) => setDaysAhead(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => onSave(settings.enabled)} disabled={loading}>
          Сохранить
        </Button>
        <Button variant="outline" onClick={onCheck} disabled={loading || unavailable}>
          Байланысты тексеру
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Клиентке еске салу: {settings.remindersEnabled ? 'қосулы' : 'өшірулі'}</div>
            <div className="text-sm text-slate-500">
              Жазылымға 10 сағат және 1 сағат қалғанда клиентке WhatsApp-пен хабарлама жіберіледі. AI жазған клиенттерге ғана
              жіберіледі.
            </div>
          </div>
          <Button
            variant={settings.remindersEnabled ? 'outline' : 'default'}
            disabled={loading || !settings.enabled}
            onClick={() => saveReminders(!settings.remindersEnabled)}
          >
            {settings.remindersEnabled ? 'Өшіру' : 'Қосу'}
          </Button>
        </div>
        {!settings.enabled ? <div className="text-sm text-slate-500">Алдымен жоғарыда Google Sheets-ті қосыңыз.</div> : null}

        <div className="text-sm text-slate-500">Мәтінде {'{date}'} — күні (26.11), {'{time}'} — уақыты (09:00).</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map(({ key, label }) => {
            const [stage, lang] = splitKey(key);
            return (
              <div key={key} className="space-y-2">
                <Label>{label}</Label>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  rows={3}
                  maxLength={500}
                  value={texts[key]}
                  onChange={(e) => setTexts((t) => ({ ...t, [key]: e.target.value }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTexts((t) => ({ ...t, [key]: settings.reminderDefaults[stage][lang] }))}
                >
                  Әдепкіге қайтару
                </Button>
              </div>
            );
          })}
        </div>
        <Button onClick={() => saveReminders(settings.remindersEnabled)} disabled={loading}>
          Мәтіндерді сақтау
        </Button>
      </div>
    </div>
  );
}
