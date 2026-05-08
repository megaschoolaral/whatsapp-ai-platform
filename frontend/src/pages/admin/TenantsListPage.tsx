import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Tenant {
  id: string;
  name: string;
  status: 'pending_setup' | 'active' | 'suspended';
  createdAt: string;
  owner: { email: string; lastLoginAt: string | null } | null;
  whatsappSession: { status: string; phoneNumber: string | null } | null;
  _count: { conversations: number; knowledgeFiles: number };
}

export function TenantsListPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<Tenant[]>('/admin/tenants');
      setTenants(data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Тенанты</h1>
        <Button onClick={() => navigate('/admin/tenants/new')}>+ Новый тенант</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Все клиенты</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-slate-500">Загрузка...</div>
          ) : tenants.length === 0 ? (
            <div className="text-slate-500">Нет тенантов. Создайте первого.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Имя</th>
                    <th className="py-2 pr-4">Статус</th>
                    <th className="py-2 pr-4">Owner</th>
                    <th className="py-2 pr-4">WhatsApp</th>
                    <th className="py-2 pr-4">Разговоры</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-medium">{t.name}</td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={
                            t.status === 'active' ? 'success' : t.status === 'suspended' ? 'danger' : 'warning'
                          }
                        >
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-slate-500">{t.owner?.email ?? '—'}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {t.whatsappSession?.phoneNumber ?? '—'}{' '}
                        <Badge variant="outline">{t.whatsappSession?.status ?? 'disconnected'}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-slate-500">{t._count.conversations}</td>
                      <td className="py-2 pr-4">
                        <Link to={`/admin/tenants/${t.id}`} className="text-blue-600 hover:underline">
                          Открыть
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
