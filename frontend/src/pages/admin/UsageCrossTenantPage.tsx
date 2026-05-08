import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface UsageRow {
  tenantId: string;
  tenantName: string;
  category: string;
  modelId: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  durationSeconds: number;
  calls: number;
}

export function UsageCrossTenantPage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  useEffect(() => {
    apiRequest<UsageRow[]>('/admin/usage').then(setRows).catch((err) => toast.error((err as Error).message));
  }, []);
  const total = rows.reduce((acc, r) => acc + r.cost, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage за 30 дней (все тенанты): ${total.toFixed(4)}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Тенант</th>
              <th className="py-2 pr-4">Категория</th>
              <th className="py-2 pr-4">Модель</th>
              <th className="py-2 pr-4">Calls</th>
              <th className="py-2 pr-4">In tokens</th>
              <th className="py-2 pr-4">Out tokens</th>
              <th className="py-2 pr-4">Cost USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="py-2 pr-4">{r.tenantName}</td>
                <td className="py-2 pr-4">{r.category}</td>
                <td className="py-2 pr-4">{r.modelId}</td>
                <td className="py-2 pr-4">{r.calls}</td>
                <td className="py-2 pr-4">{r.inputTokens}</td>
                <td className="py-2 pr-4">{r.outputTokens}</td>
                <td className="py-2 pr-4">${r.cost.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
