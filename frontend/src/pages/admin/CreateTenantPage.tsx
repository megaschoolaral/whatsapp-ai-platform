import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function CreateTenantPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    contactEmail: '',
    industry: '',
    timezone: 'Asia/Almaty',
    ownerEmail: '',
    ownerPassword: '',
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const t = await apiRequest<{ id: string }>('/admin/tenants', { method: 'POST', body: form });
      toast.success('Тенант создан');
      navigate(`/admin/tenants/${t.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Новый тенант</CardTitle>
          <CardDescription>Шаги 1 и 2 онбординга — название бизнеса и логин клиента</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Название бизнеса</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label>Timezone</Label>
                <Input
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  placeholder="Asia/Almaty"
                />
              </div>
              <div className="space-y-1">
                <Label>Контактный email клиента</Label>
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Сфера / индустрия</Label>
                <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Login email клиента</Label>
                <Input
                  type="email"
                  value={form.ownerEmail}
                  onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Временный пароль</Label>
                <Input
                  type="text"
                  value={form.ownerPassword}
                  onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                  required
                  minLength={8}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? '...' : 'Создать'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Отмена
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
