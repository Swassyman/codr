import { Link } from 'react-router';
import { AppShell } from '../components/AppShell';

export default function NotFoundPage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-ink-2">
        The link may be out of date.{' '}
        <Link to="/" className="font-medium text-accent hover:underline">
          Go to the contest list
        </Link>
        .
      </p>
    </AppShell>
  );
}
