import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Button } from './ui/button';
import { disconnectSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

export function Layout({ links }: { links: Array<{ to: string; label: string }> }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-semibold text-slate-900">
            AI Platform
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'px-3 py-1.5 rounded-md text-sm hover:bg-slate-100',
                    isActive && 'bg-slate-900 text-white hover:bg-slate-900',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 hidden sm:inline">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Выйти
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
