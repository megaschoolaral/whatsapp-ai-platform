import { cn } from '@/lib/utils';

interface ModelOption {
  id: string;
  displayName: string;
  inputPer1M?: number;
  outputPer1M?: number;
  avgCostPerMessage?: number;
  pricePerHour?: number;
  notes: string;
  supportsVision?: boolean;
}

interface Props {
  label: string;
  options: ModelOption[];
  value: string;
  onChange: (id: string) => void;
}

export function ModelSelector({ label, options, value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="grid gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              'text-left p-3 rounded-lg border transition-colors',
              value === o.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">{o.displayName}</div>
              <div className="text-xs text-slate-500">
                {o.pricePerHour != null
                  ? `$${o.pricePerHour.toFixed(2)} / час`
                  : `$${o.inputPer1M} / $${o.outputPer1M} per 1M`}
              </div>
            </div>
            {o.avgCostPerMessage != null && (
              <div className="text-xs text-slate-500 mt-0.5">≈ ${o.avgCostPerMessage} per message</div>
            )}
            <div className="text-xs text-slate-500 mt-1">{o.notes}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
