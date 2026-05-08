import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Button } from './ui/button';
import { disconnectSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

export function Layout({ links }: { links: Array<{ to: string; label: string }> }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/login', { replace: true });
  };

  // Close mobile menu on route change
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="font-semibold text-slate-900 shrink-0" onClick={closeMenu}>
            AI Platform
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/admin' || l.to === '/app'}
                className={({ isActive }) =>
                  cn(
                    'px-3 py-1.5 rounded-md text-sm whitespace-nowrap hover:bg-slate-100',
                    isActive && 'bg-slate-900 text-white hover:bg-slate-900',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-slate-500 hidden lg:inline truncate max-w-[140px]">
              {user?.email}
            </span>
            <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={handleLogout}>
              Выйти
            </Button>

            {/* Mobile burger */}
            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 hover:bg-slate-50"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Меню"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {menuOpen ? (
                  <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
                ) : (
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
                    <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
                    <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu drawer */}
        {menuOpen && (
          <div className="md:hidden border-t bg-white">
            <nav className="px-3 py-2 flex flex-col gap-1">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/admin' || l.to === '/app'}
                  onClick={closeMenu}
                  className={({ isActive }) =>
                    cn(
                      'px-3 py-2 rounded-md text-sm',
                      isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-100',
                    )
                  }
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="border-t mt-2 pt-2">
                <div className="px-3 text-xs text-slate-500 truncate">{user?.email}</div>
                <button
                  className="mt-1 w-full text-left px-3 py-2 rounded-md text-sm text-red-600 hover:bg-red-50"
                  onClick={() => {
                    closeMenu();
                    handleLogout();
                  }}
                >
                  Выйти
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6" key={location.pathname}>
        <Outlet />
      </main>
    </div>
  );
}
