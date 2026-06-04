import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { apiRequest } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ModelSelector } from '@/components/ModelSelector';

// PERSONA
export function PersonaPage() {
  const [persona, setPersona] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    apiRequest<{ aiPersona: string }>('/tenant/persona').then((r) => setPersona(r.aiPersona));
  }, []);
  const save = async () => {
    setLoading(true);
    try {
      await apiRequest('/tenant/persona', { method: 'PUT', body: { aiPersona: persona } });
      toast.success('Сохранено');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Persona</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={14} value={persona} onChange={(e) => setPersona(e.target.value)} />
        <Button onClick={save} disabled={loading}>
          Сохранить
        </Button>
      </CardContent>
    </Card>
  );
}

// MODELS
export function ModelsPage() {
  const [catalog, setCatalog] = useState<any | null>(null);
  const [choices, setChoices] = useState<{ textModelId: string; visionModelId: string; sttModelId: string }>({
    textModelId: 'gemini-3-flash',
    visionModelId: 'gemini-3-flash',
    sttModelId: 'elevenlabs-scribe-v2',
  });
  useEffect(() => {
    apiRequest<{ choices: any; catalog: any }>('/tenant/models').then((d) => {
      setCatalog(d.catalog);
      if (d.choices) setChoices(d.choices);
    });
  }, []);
  const save = async () => {
    try {
      await apiRequest('/tenant/models', { method: 'PUT', body: choices });
      toast.success('Сохранено');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  if (!catalog) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Модели и тарифы</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ModelSelector
          label="Text"
          options={Object.entries(catalog.text).map(([id, m]: [string, any]) => ({ id, ...m }))}
          value={choices.textModelId}
          onChange={(id) => setChoices({ ...choices, textModelId: id })}
        />
        <ModelSelector
          label="Vision"
          options={Object.entries(catalog.vision).map(([id, m]: [string, any]) => ({ id, ...m }))}
          value={choices.visionModelId}
          onChange={(id) => setChoices({ ...choices, visionModelId: id })}
        />
        <ModelSelector
          label="STT"
          options={Object.entries(catalog.stt).map(([id, m]: [string, any]) => ({ id, ...m }))}
          value={choices.sttModelId}
          onChange={(id) => setChoices({ ...choices, sttModelId: id })}
        />
        <Button onClick={save}>Сохранить</Button>
      </CardContent>
    </Card>
  );
}

// KEYS
const keyFields = [
  { key: 'geminiKey', label: 'Gemini API key (обязательный)' },
  { key: 'openaiKey', label: 'OpenAI API key' },
  { key: 'xaiKey', label: 'xAI (Grok) API key' },
  { key: 'elevenlabsKey', label: 'ElevenLabs API key' },
  { key: 'sonioxKey', label: 'Soniox API key' },
] as const;

export function KeysPage() {
  const [masked, setMasked] = useState<Record<string, string | null>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});

  const refresh = () => apiRequest<Record<string, string | null>>('/tenant/keys').then(setMasked);
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    try {
      await apiRequest('/tenant/keys', { method: 'PUT', body: edits });
      setEdits({});
      await refresh();
      toast.success('Сохранено');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const reveal = async (field: string) => {
    if (!window.confirm('Показать полный ключ?')) return;
    const res = await apiRequest<{ value: string | null }>(`/tenant/keys/reveal/${field}`, { method: 'POST' });
    window.prompt('Ключ', res.value ?? '');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API ключи</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {keyFields.map((f) => (
          <div key={f.key} className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label>{f.label}</Label>
              <Input
                placeholder={masked[f.key] ?? 'не задан'}
                value={edits[f.key] ?? ''}
                onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => reveal(f.key)} disabled={!masked[f.key]}>
              Reveal
            </Button>
          </div>
        ))}
        <Button onClick={save} disabled={Object.keys(edits).length === 0}>
          Сохранить
        </Button>
      </CardContent>
    </Card>
  );
}

// KNOWLEDGE
interface KbFile {
  id: string;
  filename: string;
  fileSizeBytes: number;
}
export function KnowledgePage() {
  const [files, setFiles] = useState<KbFile[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  const refresh = () => apiRequest<KbFile[]>('/tenant/knowledge').then(setFiles);
  useEffect(() => {
    refresh();
  }, []);
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    try {
      await apiRequest('/tenant/knowledge', { method: 'POST', formData: fd });
      await refresh();
      toast.success('Загружено');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Удалить?')) return;
    await apiRequest(`/tenant/knowledge/${id}`, { method: 'DELETE' });
    await refresh();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge Base</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          ref={ref}
          accept=".pdf,.docx,.txt,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <Button onClick={() => ref.current?.click()}>Загрузить файл</Button>
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between border rounded p-2 text-sm">
              <span>
                {f.filename} <span className="text-slate-400">({Math.round(f.fileSizeBytes / 1024)} KB)</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => remove(f.id)}>
                Удалить
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// USAGE
export function UsagePage() {
  const [data, setData] = useState<{
    grouped: Array<{ category: string; modelId: string; _sum: { estimatedCostUsd: number; inputTokens: number; outputTokens: number; durationSeconds: number }; _count: { _all: number } }>;
    daily: Array<{ day: string; cost: number }>;
  } | null>(null);
  useEffect(() => {
    apiRequest<typeof data>('/tenant/usage').then(setData);
  }, []);
  if (!data) return null;
  const total = data.grouped.reduce((acc, r) => acc + (r._sum.estimatedCostUsd ?? 0), 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Расходы за 30 дней: ${total.toFixed(4)}</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Категория</th>
                <th className="py-2 pr-4">Модель</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Input</th>
                <th className="py-2 pr-4">Output</th>
                <th className="py-2 pr-4">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.grouped.map((r, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{r.category}</td>
                  <td className="py-2 pr-4">{r.modelId}</td>
                  <td className="py-2 pr-4">{r._count._all}</td>
                  <td className="py-2 pr-4">{r._sum.inputTokens ?? 0}</td>
                  <td className="py-2 pr-4">{r._sum.outputTokens ?? 0}</td>
                  <td className="py-2 pr-4">${(r._sum.estimatedCostUsd ?? 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>По дням</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {data.daily.map((d, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{new Date(d.day).toLocaleDateString('ru-RU')}</td>
                  <td className="py-2 pr-4 text-right">${d.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// CHANNEL STATUS
export function ChannelStatusPage() {
  type WaStatus = { status: string; qr: string | null; phoneNumber: string | null; lastConnectedAt: string | null };
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  const refresh = async () => {
    const s = await apiRequest<WaStatus>('/tenant/whatsapp/status');
    setStatus(s);
    if (s.qr) {
      const svg = await QRCode.toString(s.qr, { type: 'svg', width: 280 });
      setQrSvg(svg);
    } else {
      setQrSvg(null);
    }
  };

  useEffect(() => {
    refresh();
    if (!token) return;
    const sock = connectSocket(token);
    sock.on('whatsapp:status', async (payload: { status: string; qr?: string }) => {
      if (payload.qr) {
        const svg = await QRCode.toString(payload.qr, { type: 'svg', width: 280 });
        setQrSvg(svg);
      }
      if (payload.status === 'connected') {
        setQrSvg(null);
      }
      await refresh();
    });
    return () => disconnectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    try {
      await apiRequest('/tenant/whatsapp/reconnect', { method: 'POST' });
      toast.info('Подключение запущено, ожидаем QR…');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp канал</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Badge variant={status?.status === 'connected' ? 'success' : status?.status === 'qr' ? 'warning' : 'default'}>
            {status?.status ?? '—'}
          </Badge>
          {status?.phoneNumber && <span className="text-sm text-slate-500">{status.phoneNumber}</span>}
        </div>
        <Button onClick={connect} variant="outline">
          {status?.status === 'connected' ? 'Переподключить' : 'Подключить (показать QR)'}
        </Button>
        {qrSvg && (
          <div className="border rounded-lg p-4 inline-block bg-white">
            <div className="text-sm font-medium mb-2">Отсканируйте QR через WhatsApp → Связанные устройства</div>
            <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
          </div>
        )}
        {status?.lastConnectedAt && (
          <div className="text-xs text-slate-500">
            Последнее подключение: {new Date(status.lastConnectedAt).toLocaleString('ru-RU')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
