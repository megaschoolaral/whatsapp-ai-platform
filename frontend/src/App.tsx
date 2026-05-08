import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { ForcePasswordChange } from '@/pages/ForcePasswordChange';
import { TenantsListPage } from '@/pages/admin/TenantsListPage';
import { CreateTenantPage } from '@/pages/admin/CreateTenantPage';
import { OnboardingChecklistPage } from '@/pages/admin/OnboardingChecklistPage';
import { UsageCrossTenantPage } from '@/pages/admin/UsageCrossTenantPage';
import { InboxPage } from '@/pages/tenant/InboxPage';
import {
  PersonaPage,
  ModelsPage,
  KeysPage,
  KnowledgePage,
  UsagePage,
  ChannelStatusPage,
} from '@/pages/tenant/SimplePages';
import { useAuthStore } from '@/stores/authStore';

function RootRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to={user.role === 'super_admin' ? '/admin' : '/app'} replace />;
}

const adminLinks = [
  { to: '/admin', label: 'Тенанты' },
  { to: '/admin/usage', label: 'Usage' },
];
const tenantLinks = [
  { to: '/app', label: 'Inbox' },
  { to: '/app/persona', label: 'Persona' },
  { to: '/app/models', label: 'Модели' },
  { to: '/app/keys', label: 'API ключи' },
  { to: '/app/knowledge', label: 'KB' },
  { to: '/app/usage', label: 'Расходы' },
  { to: '/app/channel', label: 'WhatsApp' },
];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ForcePasswordChange />} />

      <Route element={<ProtectedRoute role="super_admin" />}>
        <Route element={<Layout links={adminLinks} />}>
          <Route path="/admin" element={<TenantsListPage />} />
          <Route path="/admin/tenants/new" element={<CreateTenantPage />} />
          <Route path="/admin/tenants/:tenantId" element={<OnboardingChecklistPage />} />
          <Route path="/admin/usage" element={<UsageCrossTenantPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute role="tenant_admin" />}>
        <Route element={<Layout links={tenantLinks} />}>
          <Route path="/app" element={<InboxPage />} />
          <Route path="/app/persona" element={<PersonaPage />} />
          <Route path="/app/models" element={<ModelsPage />} />
          <Route path="/app/keys" element={<KeysPage />} />
          <Route path="/app/knowledge" element={<KnowledgePage />} />
          <Route path="/app/usage" element={<UsagePage />} />
          <Route path="/app/channel" element={<ChannelStatusPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
