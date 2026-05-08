import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiRequest } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function ForcePasswordChange() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.error('Пароли не совпадают');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Минимум 8 символов');
      return;
    }
    setLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      if (user) setUser({ ...user, mustChangePassword: false });
      toast.success('Пароль изменён');
      navigate(user?.role === 'super_admin' ? '/admin' : '/app', { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
          <CardDescription>Задайте новый пароль для вашего аккаунта</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1">
              <Label>Текущий пароль</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Новый пароль</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Подтвердите</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '...' : 'Сменить пароль'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
