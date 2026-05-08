import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const fields = [
  { key: 'geminiKey', label: 'Gemini API key', required: true, hint: 'Обязателен для RAG' },
  { key: 'openaiKey', label: 'OpenAI API key' },
  { key: 'xaiKey', label: 'xAI (Grok) API key' },
  { key: 'elevenlabsKey', label: 'ElevenLabs API key' },
  { key: 'sonioxKey', label: 'Soniox API key' },
] as const;

type Masked = Record<string, string | null>;

export function StepKeys({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const [masked, setMasked] = useState<Masked>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const refresh = () =>
    apiRequest<Masked>(`/admin/tenants/${tenantId}/keys`).then(setMasked).catch((err) => toast.error((err as Error).message));

  useEffect(() => {
    refresh();
  }, [tenantId]);

  const save = async () => {
    setLoading(true);
    try {
      await apiRequest(`/admin/tenants/${tenantId}/keys`, { method: 'PUT', body: edits });
      toast.success('Сохранено');
      setEdits({});
      await refresh();
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const reveal = async (field: string) => {
    if (!window.confirm('Показать полный ключ?')) return;
    try {
      const res = await apiRequest<{ value: string | null }>(`/admin/tenants/${tenantId}/keys/reveal/${field}`, {
        method: 'POST',
      });
      window.prompt('Скопируйте ключ', res.value ?? '');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key} className="grid sm:grid-cols-[1fr_auto_auto] items-end gap-2">
          <div className="space-y-1">
            <Label>
              {f.label}
              {('required' in f && f.required) ? <span className="text-red-600 ml-1">*</span> : null}
            </Label>
            <Input
              type="text"
              placeholder={masked[f.key] ?? 'не задан'}
              value={edits[f.key] ?? ''}
              onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
            />
            {'hint' in f && f.hint && <div className="text-xs text-slate-500">{f.hint}</div>}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => reveal(f.key)} disabled={!masked[f.key]}>
            Reveal
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEdits({ ...edits, [f.key]: '' })}>
            Очистить
          </Button>
        </div>
      ))}
      <Button onClick={save} disabled={loading || Object.keys(edits).length === 0}>
        Сохранить
      </Button>
    </div>
  );
}
