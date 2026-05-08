import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function StepPersona({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const [persona, setPersona] = useState('');
  const [testMsg, setTestMsg] = useState('Здравствуйте!');
  const [testReply, setTestReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest<{ aiPersona: string }>(`/admin/tenants/${tenantId}`).then((t) => setPersona(t.aiPersona ?? ''));
  }, [tenantId]);

  const save = async () => {
    setLoading(true);
    try {
      await apiRequest(`/admin/tenants/${tenantId}/persona`, { method: 'PUT', body: { aiPersona: persona } });
      toast.success('Сохранено');
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    setTestReply(null);
    try {
      const res = await apiRequest<{ reply: string }>(`/admin/tenants/${tenantId}/persona/test`, {
        method: 'POST',
        body: { message: testMsg },
      });
      setTestReply(res.reply);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>System prompt (AI persona)</Label>
        <Textarea
          rows={10}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="Ты — менеджер кафе X. Отвечай дружелюбно..."
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={loading}>
          Сохранить
        </Button>
      </div>
      <div className="border-t pt-3 space-y-2">
        <Label>Тест с сообщением</Label>
        <div className="flex gap-2">
          <Input value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
          <Button variant="outline" onClick={test}>
            Тест
          </Button>
        </div>
        {testReply !== null && (
          <div className="rounded-md bg-slate-50 border p-3 text-sm whitespace-pre-wrap">{testReply}</div>
        )}
      </div>
    </div>
  );
}
