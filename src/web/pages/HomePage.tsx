import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ContestSummaryDTO } from '../../shared/api';
import { api } from '../lib/api';
import { isStaffUser, useMe } from '../lib/auth';
import { formatSpan, formatWhen, minutesLabel } from '../lib/format';
import { useServerNow } from '../lib/server-time';
import { AppShell } from '../components/AppShell';
import { SignInForm } from '../components/SignInForm';
import { EmptyState, Spinner } from '../components/ui';
import { JoinWithCode } from '../components/JoinWithCode';

function timingSummary(c: ContestSummaryDTO, now: number) {
  switch (c.timingMode) {
    case 'fixed_window':
      return `Everyone finishes at ${formatWhen(c.endsAt, now)}.`;
    case 'personal_window':
      return `${minutesLabel(c.durationMinutes ?? 0)} from when you start. Entry closes ${formatWhen(c.endsAt, now)}.`;
    case 'per_question':
      return `Each question has its own timer. Closes ${formatWhen(c.endsAt, now)}.`;
  }
}

function statusLine(c: ContestSummaryDTO, now: number) {
  const starts = Date.parse(c.startsAt);
  const ends = Date.parse(c.endsAt);
  if (c.finishedAt) return 'You finished';
  if (c.phase === 'upcoming') return `Starts in ${formatSpan(starts - now)}`;
  if (c.phase === 'live') return c.timingMode === 'personal_window' ? `Entry closes in ${formatSpan(ends - now)}` : `Ends in ${formatSpan(ends - now)}`;
  return `Ended ${formatWhen(c.timingMode === 'personal_window' ? c.finalEndsAt : c.endsAt, now)}`;
}

function ContestRow({ contest: c, now }: { contest: ContestSummaryDTO; now: number }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
      <div className="min-w-0">
        <Link to={`/contests/${c.id}`} className="text-base font-semibold text-ink hover:text-accent">
          {c.name}
        </Link>
        <p className="mt-0.5 text-sm text-ink-2">{timingSummary(c, now)}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-ink-3">
          <span>
            {c.questionCount} question{c.questionCount === 1 ? '' : 's'}
          </span>
          {c.viewOnce && <span className="rounded bg-raised px-1.5 text-ink-2">View once</span>}
          {c.sequential && <span className="rounded bg-raised px-1.5 text-ink-2">In order</span>}
          {c.registered && <span className="rounded bg-accent-soft px-1.5 text-accent">Joined</span>}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-ink-2 tabular-nums">{statusLine(c, now)}</span>
        <Link
          to={`/contests/${c.id}`}
          className="inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-sm font-medium text-ink hover:bg-raised"
        >
          {c.phase === 'ended' || c.finishedAt ? 'View' : 'Open'}
        </Link>
      </div>
    </li>
  );
}

function ContestGroup({ title, contests, now }: { title: string; contests: ContestSummaryDTO[]; now: number }) {
  if (contests.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
      <ul className="mt-1 divide-y divide-line border-y border-line">
        {contests.map((c) => (
          <ContestRow key={c.id} contest={c} now={now} />
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const me = useMe();
  const user = me.data?.user ?? null;
  const now = useServerNow(15_000);
  const list = useQuery({
    queryKey: ['contests', user?.id ?? 0],
    queryFn: () => api.get<{ contests: ContestSummaryDTO[] }>('/api/contests'),
    refetchInterval: 60_000,
  });
  const contests = list.data?.contests ?? [];
  const live = contests.filter((c) => c.phase === 'live');
  const upcoming = contests.filter((c) => c.phase === 'upcoming');
  const ended = contests.filter((c) => c.phase === 'ended').reverse();

  return (
    <AppShell>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">Contests</h1>
          {list.isPending ? (
            <Spinner />
          ) : contests.length === 0 ? (
            <EmptyState title="No contests are open right now.">
              {isStaffUser(user) ? (
                <>
                  Build one in the{' '}
                  <Link className="font-medium text-accent hover:underline" to="/manage/contests">
                    contest builder
                  </Link>
                  . Published public contests appear here.
                </>
              ) : (
                'When an organizer publishes a contest it appears here. If you were given a join code, enter it on the right.'
              )}
            </EmptyState>
          ) : (
            <>
              <ContestGroup title="Live now" contests={live} now={now} />
              <ContestGroup title="Upcoming" contests={upcoming} now={now} />
              <ContestGroup title="Finished" contests={ended} now={now} />
            </>
          )}
        </div>
        <aside className="flex flex-col gap-8">
          {!me.isPending && !user && (
            <section className="rounded-lg border border-line bg-surface p-5">
              <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
              <SignInForm />
            </section>
          )}
          {!user?.isGuest && <JoinWithCode signedIn={!!user} />}
        </aside>
      </div>
    </AppShell>
  );
}
