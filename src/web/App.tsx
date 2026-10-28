import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { Role } from '../shared/types';
import { useMe } from './lib/auth';
import { useServerEvents } from './lib/events';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';

const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const RunnerPage = lazy(() => import('./pages/admin/RunnerPage'));

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

/** Sends signed-out visitors to sign in and blocks roles that lack access. */
function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <PageFallback />;
  const user = me.data?.user;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <AppShell>
        <h1 className="text-2xl font-semibold tracking-tight">No access</h1>
        <p className="mt-2 text-ink-2">This page is for {roles.join(' and ')} accounts.</p>
      </AppShell>
    );
  }
  return <>{children}</>;
}

export function App() {
  const me = useMe();
  useServerEvents(!!me.data?.user);
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/admin/runner"
          element={
            <RequireRole roles={['admin']}>
              <RunnerPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
