import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface KbFile {
  id: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string | null;
  createdAt: string;
}

export function StepKnowledge({ tenantId, onChanged }: { tenantId: string; onChanged: () => void }) {
  const [files, setFiles] = useState<KbFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    const data = await apiRequest<KbFile[]>(`/admin/tenants/${tenantId}/knowledge`);
    setFiles(data);
  };
  useEffect(() => {
    refresh();
  }, [tenantId]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiRequest(`/admin/tenants/${tenantId}/knowledge`, { method: 'POST', formData: fd });
      toast.success('Загружено');
      await refresh();
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Удалить файл?')) return;
    try {
      await apiRequest(`/admin/tenants/${tenantId}/knowledge/${id}`, { method: 'DELETE' });
      await refresh();
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="file"
        ref={fileInputRef}
        accept=".pdf,.docx,.txt,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? 'Загрузка...' : 'Загрузить файл (PDF / DOCX / TXT)'}
      </Button>
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between border rounded p-2 text-sm">
            <span>
              {f.filename} <span className="text-slate-400">({Math.round(f.fileSizeBytes / 1024)} KB)</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => remove(f.id)}>
              Удалить
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
