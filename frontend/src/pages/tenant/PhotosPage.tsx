import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest, fetchBlob } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const MAX_PER_CATEGORY = 10;

interface PhotoCategory {
  id: string;
  label: string;
  photos: { id: string; sizeBytes: number }[];
}

function Thumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchBlob(`/tenant/photos/${id}/image`)
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? (
    <img src={src} alt="" className="h-24 w-24 rounded object-cover" />
  ) : (
    <div className="h-24 w-24 rounded bg-slate-100" />
  );
}

function CategoryBlock({ category, onChange }: { category: PhotoCategory; onChange: () => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const full = category.photos.length >= MAX_PER_CATEGORY;

  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        try {
          await apiRequest(`/tenant/photos/${category.id}`, { method: 'POST', formData: fd });
        } catch (err) {
          toast.error((err as Error).message);
          break;
        }
      }
    } finally {
      await onChange();
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Удалить фото?')) return;
    try {
      await apiRequest(`/tenant/photos/${id}`, { method: 'DELETE' });
      await onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{category.label}</span>
          <span className="text-sm font-normal text-slate-500">
            {category.photos.length} / {MAX_PER_CATEGORY}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {category.photos.map((p) => (
            <div key={p.id} className="relative">
              <Thumb id={p.id} />
              <button
                type="button"
                aria-label="Удалить"
                className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs shadow"
                onClick={() => remove(p.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <input
          type="file"
          ref={ref}
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
          }}
        />
        <Button size="sm" disabled={full || busy} onClick={() => ref.current?.click()}>
          {full ? 'Лимит достигнут' : busy ? 'Загрузка…' : 'Загрузить фото'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function PhotosPage() {
  const [categories, setCategories] = useState<PhotoCategory[]>([]);
  const refresh = () =>
    apiRequest<{ categories: PhotoCategory[] }>('/tenant/photos')
      .then((r) => setCategories(r.categories))
      .catch((err) => {
        toast.error((err as Error).message);
      });
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Фото, которые бот отправит клиенту, когда он попросит показать кухню, ванную, зону отдыха или номер. До {MAX_PER_CATEGORY} фото
        в каждой категории.
      </p>
      {categories.map((c) => (
        <CategoryBlock key={c.id} category={c} onChange={refresh} />
      ))}
    </div>
  );
}
