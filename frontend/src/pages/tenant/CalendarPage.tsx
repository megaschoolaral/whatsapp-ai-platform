import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface CalendarStatus {
  connected: boolean;
  status: 'connected' | 'error' | 'disconnected';
  googleEmail: string | null;
  connectedAt: string | null;
  lastErrorMessage: string | null;
}

interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  startAt: string;
  endAt: string;
  status: 'booked' | 'cancelled';
}

export function CalendarPage() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const refresh = async () => {
    const s = await apiRequest<CalendarStatus>('/tenant/calendar/status');
    setStatus(s);
    const appts = await apiRequest<Appointment[]>('/tenant/calendar/appointments');
    setAppointments(appts);
  };

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar_connected')) toast.success('Google Calendar подключён');
    if (params.get('calendar_error')) toast.error('Не удалось подключить Google Calendar');
    if (params.toString()) window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    try {
      const { url } = await apiRequest<{ url: string }>('/tenant/calendar/connect-url');
      window.location.href = url;
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Отключить Google Calendar?')) return;
    await apiRequest('/tenant/calendar/disconnect', { method: 'POST' });
    await refresh();
    toast.success('Отключено');
  };

  const badgeVariant = status?.status === 'connected' ? 'success' : status?.status === 'error' ? 'danger' : 'default';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant={badgeVariant}>{status?.status ?? '—'}</Badge>
            {status?.googleEmail && <span className="text-sm text-slate-500">{status.googleEmail}</span>}
          </div>
          {status?.lastErrorMessage && <div className="text-sm text-red-600">{status.lastErrorMessage}</div>}
          {status?.connected ? (
            <Button onClick={disconnect} variant="outline">
              Отключить
            </Button>
          ) : (
            <Button onClick={connect}>Подключить Google Calendar</Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Последние брони</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Клиент</th>
                <th className="py-2 pr-4">Телефон</th>
                <th className="py-2 pr-4">Время</th>
                <th className="py-2 pr-4">Статус</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{a.clientName}</td>
                  <td className="py-2 pr-4">{a.clientPhone}</td>
                  <td className="py-2 pr-4">{new Date(a.startAt).toLocaleString('ru-RU')}</td>
                  <td className="py-2 pr-4">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {appointments.length === 0 && <div className="text-sm text-slate-400 py-2">Пока нет броней</div>}
        </CardContent>
      </Card>
    </div>
  );
}
