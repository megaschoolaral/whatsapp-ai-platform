import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StepInfo } from './steps/StepInfo';
import { StepKeys } from './steps/StepKeys';
import { StepModels } from './steps/StepModels';
import { StepPersona } from './steps/StepPersona';
import { StepWhatsapp } from './steps/StepWhatsapp';
import { StepKnowledge } from './steps/StepKnowledge';

interface OnboardingState {
  status: 'pending_setup' | 'active' | 'suspended';
  steps: {
    info: boolean;
    credentials: boolean;
    keys: boolean;
    models: boolean;
    persona: boolean;
    whatsapp: boolean;
    knowledge: boolean;
  };
  ready: boolean;
}

interface Tenant {
  id: string;
  name: string;
  status: string;
  owner: { email: string } | null;
}

const stepLabels: Array<{ key: keyof OnboardingState['steps']; label: string }> = [
  { key: 'info', label: '1. Tenant Info' },
  { key: 'credentials', label: '2. Login Credentials' },
  { key: 'keys', label: '3. API Keys' },
  { key: 'models', label: '4. AI Models' },
  { key: 'persona', label: '5. AI Persona' },
  { key: 'whatsapp', label: '6. WhatsApp QR' },
  { key: 'knowledge', label: '7. Knowledge Base (опционально)' },
];

export function OnboardingChecklistPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [activeStep, setActiveStep] = useState<keyof OnboardingState['steps'] | null>(null);

  const refresh = async () => {
    if (!tenantId) return;
    try {
      const [t, s] = await Promise.all([
        apiRequest<Tenant>(`/admin/tenants/${tenantId}`),
        apiRequest<OnboardingState>(`/admin/tenants/${tenantId}/onboarding`),
      ]);
      setTenant(t);
      setState(s);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  useEffect(() => {
    refresh();
  }, [tenantId]);

  const activate = async () => {
    if (!tenantId) return;
    try {
      await apiRequest(`/admin/tenants/${tenantId}/activate`, { method: 'POST' });
      toast.success('Тенант активирован');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const suspend = async () => {
    if (!tenantId) return;
    try {
      await apiRequest(`/admin/tenants/${tenantId}/suspend`, { method: 'POST', body: { reason: 'Manual suspend' } });
      toast.success('Suspended');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!tenantId) return;
    if (!window.confirm('Удалить тенанта? Это hard delete.')) return;
    const confirmText = window.prompt('Введите DELETE для подтверждения');
    if (confirmText !== 'DELETE') return;
    try {
      await apiRequest(`/admin/tenants/${tenantId}`, { method: 'DELETE', body: { confirm: 'DELETE' } });
      toast.success('Удалено');
      navigate('/admin');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!tenant || !state) return <div className="text-slate-500">Загрузка...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{tenant.name}</h1>
          <div className="text-sm text-slate-500">Owner: {tenant.owner?.email ?? '—'}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              state.status === 'active' ? 'success' : state.status === 'suspended' ? 'danger' : 'warning'
            }
          >
            {state.status}
          </Badge>
          {state.status === 'active' ? (
            <Button variant="outline" onClick={suspend}>
              Suspend
            </Button>
          ) : null}
          <Button variant="destructive" onClick={remove}>
            Удалить
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Чек-лист онбординга</CardTitle>
          <CardDescription>
            Заполните шаги в любом порядке. Шаги 1–6 обязательны для активации, шаг 7 — опционально.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {stepLabels.map((s) => {
              const done = state.steps[s.key];
              const isActive = activeStep === s.key;
              return (
                <li
                  key={s.key}
                  className="border rounded-lg p-3 cursor-pointer hover:bg-slate-50"
                  onClick={() => setActiveStep(isActive ? null : s.key)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{done ? '✅' : '⚪'}</span>
                      <span className="font-medium">{s.label}</span>
                    </div>
                    <span className="text-xs text-slate-500">{isActive ? 'свернуть' : 'открыть'}</span>
                  </div>
                  {isActive && (
                    <div className="mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                      {s.key === 'info' && tenantId && <StepInfo tenantId={tenantId} onSaved={refresh} />}
                      {s.key === 'credentials' && (
                        <div className="text-sm text-slate-500">
                          Логин клиента создаётся при создании тенанта (на странице "Новый тенант"). Сейчас установлен:{' '}
                          <code>{tenant.owner?.email ?? '—'}</code>
                        </div>
                      )}
                      {s.key === 'keys' && tenantId && <StepKeys tenantId={tenantId} onSaved={refresh} />}
                      {s.key === 'models' && tenantId && <StepModels tenantId={tenantId} onSaved={refresh} />}
                      {s.key === 'persona' && tenantId && <StepPersona tenantId={tenantId} onSaved={refresh} />}
                      {s.key === 'whatsapp' && tenantId && <StepWhatsapp tenantId={tenantId} onConnected={refresh} />}
                      {s.key === 'knowledge' && tenantId && <StepKnowledge tenantId={tenantId} onChanged={refresh} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-6">
            <Button disabled={!state.ready || state.status === 'active'} onClick={activate}>
              {state.status === 'active' ? 'Активирован' : 'Activate Tenant'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
