import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ReceiptCheckSettings {
  enabled: boolean;
  sellerIin: string | null;
  minAmount: number | null;
  /** Masked by the server; the real token is never sent back. */
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

export function StepReceiptCheck({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<ReceiptCheckSettings | null>(null);
  const [sellerIin, setSellerIin] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [chatId, setChatId] = useState('');
  const [newToken, setNewToken] = useState('');
  const [loading, setLoading] = useState(false);

  const apply = (s: ReceiptCheckSettings) => {
    setSettings(s);
    setSellerIin(s.sellerIin ?? '');
    setMinAmount(s.minAmount === null ? '' : String(s.minAmount));
    setChatId(s.telegramChatId ?? '');
    setNewToken('');
  };

  useEffect(() => {
    apiRequest<ReceiptCheckSettings>(`/admin/tenants/${tenantId}/receipt-check`)
      .then(apply)
      .catch((err) => toast.error((err as Error).message));
  }, [tenantId]);

  const save = async (enabled: boolean) => {
    setLoading(true);
    try {
      const saved = await apiRequest<ReceiptCheckSettings>(`/admin/tenants/${tenantId}/receipt-check`, {
        method: 'PUT',
        body: {
          enabled,
          sellerIin: sellerIin.trim() || null,
          minAmount: minAmount.trim() === '' ? null : Number(minAmount),
          telegramChatId: chatId.trim() || null,
          ...(newToken.trim() ? { telegramBotToken: newToken.trim() } : {}),
        },
      });
      apply(saved);
      toast.success(enabled ? 'Чек тексеру қосулы' : 'Сохранено');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!settings) return <div className="text-slate-500">Загрузка...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <div className="font-medium">{settings.enabled ? 'Қосулы' : 'Өшірулі'}</div>
          <div className="text-sm text-slate-500">
            Қосулы болса, клиент жіберген Kaspi чегі оқылып, Telegram арнасына хабарланады.
          </div>
        </div>
        <Button
          variant={settings.enabled ? 'outline' : 'default'}
          disabled={loading}
          onClick={() => save(!settings.enabled)}
        >
          {settings.enabled ? 'Өшіру' : 'Қосу'}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Сатушының ИИН-і (12 сан)</Label>
          <Input value={sellerIin} maxLength={12} onChange={(e) => setSellerIin(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Ең төмен сома, ₸ (міндетті емес)</Label>
          <Input type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Telegram бот токені</Label>
          <Input
            type="password"
            autoComplete="off"
            placeholder={settings.telegramBotToken ?? '123456789:AA...'}
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
          />
          {settings.telegramBotToken ? (
            <div className="text-xs text-slate-500">Сақталған: {settings.telegramBotToken}. Бос қалдырсаңыз, өзгермейді.</div>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>Telegram арна ID</Label>
          <Input placeholder="-1001234567890" value={chatId} onChange={(e) => setChatId(e.target.value)} />
        </div>
      </div>

      <Button onClick={() => save(settings.enabled)} disabled={loading}>
        Сохранить
      </Button>
    </div>
  );
}
