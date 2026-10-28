import { useNavigate, useSearchParams } from 'react-router';
import { Wordmark, ThemeToggle } from '../components/AppShell';
import { SignInForm } from '../components/SignInForm';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-12 items-center justify-between px-4">
        <Wordmark />
        <ThemeToggle />
      </div>
      <main className="mx-auto w-full max-w-sm flex-1 px-4 pt-[12vh]">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-ink-2">Use the account your organizer gave you, or one you created here.</p>
        <SignInForm onSignedIn={() => navigate(safeNext, { replace: true })} />
      </main>
    </div>
  );
}
