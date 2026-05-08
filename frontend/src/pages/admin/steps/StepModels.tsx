import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/components/ModelSelector';

interface Catalog {
  text: Record<string, any>;
  vision: Record<string, any>;
  stt: Record<string, any>;
  lastUpdated: string;
}

interface Choices {
  textModelId: string;
  visionModelId: string;
  sttModelId: string;
}

export function StepModels({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [choices, setChoices] = useState<Choices>({
    textModelId: 'gemini-3-flash',
    visionModelId: 'gemini-3-flash',
    sttModelId: 'elevenlabs-scribe-v2',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiRequest<{ choices: Choices | null; catalog: Catalog }>(`/admin/tenants/${tenantId}/models`).then((d) => {
      setCatalog(d.catalog);
      if (d.choices) setChoices(d.choices);
    });
  }, [tenantId]);

  const save = async () => {
    setLoading(true);
    try {
      await apiRequest(`/admin/tenants/${tenantId}/models`, { method: 'PUT', body: choices });
      toast.success('Сохранено');
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!catalog) return <div className="text-slate-500">Загрузка...</div>;

  const textOptions = Object.entries(catalog.text).map(([id, m]) => ({ id, ...m }));
  const visionOptions = Object.entries(catalog.vision).map(([id, m]) => ({ id, ...m }));
  const sttOptions = Object.entries(catalog.stt).map(([id, m]) => ({ id, ...m }));

  return (
    <div className="space-y-4">
      <ModelSelector
        label="Text Model"
        options={textOptions}
        value={choices.textModelId}
        onChange={(id) => setChoices({ ...choices, textModelId: id })}
      />
      <ModelSelector
        label="Vision Model"
        options={visionOptions}
        value={choices.visionModelId}
        onChange={(id) => setChoices({ ...choices, visionModelId: id })}
      />
      <ModelSelector
        label="STT Model"
        options={sttOptions}
        value={choices.sttModelId}
        onChange={(id) => setChoices({ ...choices, sttModelId: id })}
      />
      <Button onClick={save} disabled={loading}>
        Сохранить
      </Button>
      <div className="text-xs text-slate-400">Цены обновлены: {catalog.lastUpdated}</div>
    </div>
  );
}
