import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function StepInfo({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', contactEmail: '', industry: '', timezone: 'Asia/Almaty' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest<{ name: string; contactEmail: string | null; industry: string | null; timezone: string }>(
      `/admin/tenants/${tenantId}`,
    ).then((t) =>
      setForm({
        name: t.name ?? '',
        contactEmail: t.contactEmail ?? '',
        industry: t.industry ?? '',
        timezone: t.timezone ?? 'Asia/Almaty',
      }),
    );
  }, [tenantId]);

  const save = async () => {
    setLoading(true);
    try {
      await apiRequest(`/admin/tenants/${tenantId}`, { method: 'PATCH', body: form });
      toast.success('Сохранено');
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Название бизнеса</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Timezone</Label>
          <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Контактный email</Label>
          <Input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Индустрия</Label>
          <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </div>
      </div>
      <Button onClick={save} disabled={loading}>
        Сохранить
      </Button>
    </div>
  );
}
