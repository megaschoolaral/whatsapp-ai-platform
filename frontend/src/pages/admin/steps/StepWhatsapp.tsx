import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Status {
  status: string;
  qr: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  lastDisconnectReason: string | null;
}

export function StepWhatsapp({ tenantId, onConnected }: { tenantId: string; onConnected: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<Status | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const s = await apiRequest<Status>(`/admin/tenants/${tenantId}/whatsapp/status`);
    setStatus(s);
    if (s.qr) {
      const svg = await QRCode.toString(s.qr, { type: 'svg', width: 320 });
      setQrSvg(svg);
    } else {
      setQrSvg(null);
    }
  };

  useEffect(() => {
    refresh();
    if (!token) return;
    const sock = connectSocket(token, tenantId);
    sock.on('whatsapp:status', async (payload: { status: string; qr?: string }) => {
      if (payload.qr) {
        const svg = await QRCode.toString(payload.qr, { type: 'svg', width: 320 });
        setQrSvg(svg);
      }
      if (payload.status === 'connected') {
        setQrSvg(null);
        await refresh();
        onConnected();
      } else {
        await refresh();
      }
    });
    return () => disconnectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const init = async () => {
    try {
      await apiRequest(`/admin/tenants/${tenantId}/whatsapp/init`, { method: 'POST' });
      toast.info('Запущено подключение, ожидаем QR…');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const refreshQr = async () => {
    try {
      await apiRequest(`/admin/tenants/${tenantId}/whatsapp/refresh-qr`, { method: 'POST' });
      toast.info('Перезапуск QR…');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const disconnect = async () => {
    try {
      await apiRequest(`/admin/tenants/${tenantId}/whatsapp/disconnect`, { method: 'POST' });
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3" ref={containerRef}>
      <div className="flex items-center gap-3">
        <Badge
          variant={
            status?.status === 'connected' ? 'success' : status?.status === 'qr' ? 'warning' : 'default'
          }
        >
          {status?.status ?? 'unknown'}
        </Badge>
        {status?.phoneNumber && <span className="text-sm text-slate-500">{status.phoneNumber}</span>}
      </div>
      <div className="flex gap-2">
        <Button onClick={init}>Подключить (показать QR)</Button>
        <Button variant="outline" onClick={refreshQr}>
          Refresh QR
        </Button>
        <Button variant="ghost" onClick={disconnect}>
          Отключить
        </Button>
      </div>

      {qrSvg && (
        <div className="border rounded-lg p-4 inline-block bg-white">
          <div className="text-sm font-medium mb-2">Отсканируйте QR с телефона клиента (WhatsApp → Linked devices)</div>
          <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
        </div>
      )}
      {status?.lastDisconnectReason && (
        <div className="text-xs text-slate-500">Последняя ошибка: {status.lastDisconnectReason}</div>
      )}
    </div>
  );
}
