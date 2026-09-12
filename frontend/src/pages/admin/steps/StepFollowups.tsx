import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FollowupSettings {
  enabled: boolean;
  delay1hMinutes: number;
  delay2hMinutes: number;
  message1Text: string;
  message2Text: string;
}

export function StepFollowups({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<FollowupSettings>({
    enabled: false,
    delay1hMinutes: 60,
    delay2hMinutes: 720,
    message1Text: '',
    message2Text: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest<FollowupSettings>(`/admin/tenants/${tenantId}/followups`).then(setSettings);
  }, [tenantId]);

  const save = async () => {
    setLoading(true);
    try {
      const saved = await apiRequest<FollowupSettings>(`/admin/tenants/${tenantId}/followups`, {
        method: 'PUT',
        body: settings,
      });
      setSettings(saved);
      toast.success('Сохранено');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
        />
        <span>Қосу</span>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>1-ші follow-up (минут)</Label>
          <Input
            type="number"
            min={1}
            value={settings.delay1hMinutes}
            onChange={(e) => setSettings({ ...settings, delay1hMinutes: Number(e.target.value) })}
          />
          <Textarea
            rows={3}
            placeholder="Хабар мәтіні"
            value={settings.message1Text}
            onChange={(e) => setSettings({ ...settings, message1Text: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>2-ші follow-up (минут)</Label>
          <Input
            type="number"
            min={1}
            value={settings.delay2hMinutes}
            onChange={(e) => setSettings({ ...settings, delay2hMinutes: Number(e.target.value) })}
          />
          <Textarea
            rows={3}
            placeholder="Хабар мәтіні"
            value={settings.message2Text}
            onChange={(e) => setSettings({ ...settings, message2Text: e.target.value })}
          />
        </div>
      </div>
      <Button onClick={save} disabled={loading}>
        Сохранить
      </Button>
    </div>
  );
}
