import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { ContestQuestionStateDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { useContestLobby, useContestState } from '../../lib/contest';
import { formatSpan, formatWhen, minutesLabel } from '../../lib/format';
import { useServerNow } from '../../lib/server-time';
import { cn } from '../../lib/cn';
import { AppShell } from '../../components/AppShell';
import { JoinWithCode } from '../../components/JoinWithCode';
import { Markdown } from '../../components/Markdown';
import { ContestClock } from '../../components/contest/Clock';
import { isSolved } from '../../components/contest/Navigator';
import { ContestRules } from '../../components/contest/Rules';
import { Button, ConfirmDialog, ErrorNote, Notice, Spinner } from '../../components/ui';

function QuestionRow({ q, onOpen, showScores }: { q: ContestQuestionStateDTO; onOpen: () => void; showScores: boolean }) {
  const disabled = q.state === 'locked' || q.state === 'waiting';
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onOpen}
        className={cn('grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-3 py-3 text-left', !disabled && 'hover:bg-raised', disabled && 'cursor-not-allowed')}
      >
        <span className={cn('font-mono text-base font-semibold', disabled ? 'text-ink-3' : 'text-ink')}>{q.letter}</span>
        <span className="min-w-0">
          <span className={cn('block truncate font-medium', disabled && 'text-ink-3')}>{q.title}</span>
          <span className="text-xs text-ink-3">
            {q.state === 'open' ? 'Open now' : q.state === 'available' ? (q.durationMinutes ? `${minutesLabel(q.durationMinutes)} once opened` : 'Not opened yet') : q.reason}
          </span>
        </span>
        <span className="flex items-center gap-3 text-sm tabular-nums">
          {showScores && q.bestScore != null && (
            <span className={isSolved(q) ? 'text-ok' : 'text-ink-2'}>
              {q.bestScore} / {q.points}
            </span>
          )}
          {!showScores && <span className="text-ink-3">{q.points} pts</span>}
          {q.state === 'locked' && <Lock className="size-4 text-ink-3" aria-label="Locked" />}
        </span>
      </button>
    </li>
  );
}

export default function ContestLobbyPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useUser();
  const now = useServerNow(1000);
  const lobby = useContestLobby(id);
  const c = lobby.data;
  const participating = !!c?.participant;
  const state = useContestState(id, participating);
  const [confirmStart, setConfirmStart] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<ContestQuestionStateDTO | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contest', id] });
    void qc.invalidateQueries({ queryKey: ['contest-state', id] });
  };
  const register = useMutation({ mutationFn: () => api.post(`/api/contests/${id}/register`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const enter = useMutation({
    mutationFn: () => api.post(`/api/contests/${id}/enter`),
    onSuccess: () => {
      setConfirmStart(false);
      refresh();
    },
    onError: (e) => {
      setConfirmStart(false);
      toast.error(errorMessage(e));
    },
  });

  if (lobby.isPending) {
    return (
      <AppShell>
        <Spinner />
      </AppShell>
    );
  }
  if (lobby.error || !c) {
    return (
      <AppShell>
        <ErrorNote>{lobby.error ? errorMessage(lobby.error) : 'Contest not found.'}</ErrorNote>
      </AppShell>
    );
  }

  const s = state.data;
  const entered = !!c.participant?.enteredAt;
  const startsIn = Date.parse(c.startsAt) - now;
  const endsIn = Date.parse(c.endsAt) - now;
  const openQuestion = (q: ContestQuestionStateDTO) => {
    if (s?.current && s.current !== q.questionId) setPendingOpen(q);
    else navigate(`/contests/${id}/q/${q.letter}`);
  };
  const firstOpenable = s?.questions.find((q) => q.state === 'open') ?? s?.questions.find((q) => q.state === 'available');
  const needsConfirm = c.timingMode !== 'fixed_window' || c.viewOnce;
  const currentLetter = s?.questions.find((q) => q.questionId === s.current)?.letter;

  let status: string;
  if (c.phase === 'upcoming') status = `Starts ${formatWhen(c.startsAt, now)}, in ${formatSpan(startsIn)}.`;
  else if (c.phase === 'live') status = c.timingMode === 'personal_window' ? `Open now. Entry closes in ${formatSpan(endsIn)}.` : `Live now. Ends in ${formatSpan(endsIn)}.`;
  else status = `Ended ${formatWhen(c.finalEndsAt, now)}.`;

  return (
    <AppShell>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Contests
      </Link>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{c.name}</h1>
          <p className="mt-2 text-ink-2 tabular-nums">{status}</p>
          {c.description.trim() && <Markdown text={c.description} className="mt-6" />}
          <section className="mt-8">
            <h2 className="mb-3 text-base font-semibold">How this contest works</h2>
            <ContestRules contest={c} now={now} />
          </section>
          {c.leaderboardEnabled && (participating || c.isStaff) && (
            <p className="mt-8">
              <Link to={`/contests/${c.id}/leaderboard`} className="text-sm font-medium text-accent hover:underline">
                Leaderboard
              </Link>
            </p>
          )}
          {c.isStaff && (
            <Notice className="mt-8">
              You organize this contest.{' '}
              <Link to={`/manage/contests/${c.id}`} className="font-medium text-accent hover:underline">
                Edit it
              </Link>{' '}
              or{' '}
              <Link to={`/manage/contests/${c.id}/results`} className="font-medium text-accent hover:underline">
                see results
              </Link>
              .
            </Notice>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          {!user ? (
            <div className="rounded-lg border border-line bg-surface p-5">
              <p className="text-sm text-ink-2">Sign in to take part, or join with the code from your organizer.</p>
              <Link to={`/login?next=/contests/${c.id}`} className="mt-3 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-accent-hover">
                Sign in
              </Link>
            </div>
          ) : !participating ? (
            c.canRegister ? (
              <div className="rounded-lg border border-line bg-surface p-5">
                <p className="mb-3 text-sm text-ink-2">Register to take part. You can start once the contest opens.</p>
                <Button variant="primary" onClick={() => register.mutate()} loading={register.isPending}>
                  Register
                </Button>
              </div>
            ) : c.isStaff ? null : (
              <JoinWithCode signedIn />
            )
          ) : !entered ? (
            <div className="rounded-lg border border-line bg-surface p-5">
              {c.phase === 'upcoming' ? (
                <>
                  <p className="text-sm text-ink-2">You are registered. The start button appears when the contest opens.</p>
                  <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{formatSpan(startsIn)}</p>
                </>
              ) : c.phase === 'live' ? (
                <>
                  <p className="mb-3 text-sm text-ink-2">
                    {c.timingMode === 'personal_window' ? `Your ${minutesLabel(c.durationMinutes ?? 0)} start when you press Start.` : 'Read the rules, then start when you are ready.'}
                  </p>
                  <Button variant="primary" onClick={() => (needsConfirm ? setConfirmStart(true) : enter.mutate())} loading={enter.isPending}>
                    Start contest
                  </Button>
                </>
              ) : (
                <p className="text-sm text-ink-2">This contest has closed.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {s && !s.over && s.participantDeadline && c.timingMode !== 'per_question' && (
                <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
                  <span className="text-sm text-ink-2">Time left</span>
                  <ContestClock deadline={s.participantDeadline} label="Time left" onExpire={refresh} />
                </div>
              )}
              {s?.over ? (
                <Notice>{s.finished ? 'You finished this contest.' : (s.lock?.message ?? 'Your contest is over.')} Your results are below.</Notice>
              ) : (
                firstOpenable && (
                  <Button variant="primary" onClick={() => openQuestion(firstOpenable)}>
                    {firstOpenable.state === 'open' ? `Continue question ${firstOpenable.letter}` : `Open question ${firstOpenable.letter}`}
                  </Button>
                )
              )}
              {s && (
                <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {s.questions.map((q) => (
                    <QuestionRow key={q.questionId} q={q} onOpen={() => openQuestion(q)} showScores={s.questions.some((x) => x.bestScore != null)} />
                  ))}
                </ol>
              )}
            </div>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title="Start the contest?"
        description={
          <ul className="list-disc space-y-1 pl-5">
            {c.timingMode === 'personal_window' && <li>Your {minutesLabel(c.durationMinutes ?? 0)} start now and cannot be paused.</li>}
            {c.timingMode === 'per_question' && <li>Each question's timer starts when you first open it.</li>}
            {c.viewOnce && <li>You can open each question only once. Leaving a question locks it.</li>}
          </ul>
        }
        confirmLabel="Start now"
        loading={enter.isPending}
        onConfirm={() => enter.mutate()}
      />
      <ConfirmDialog
        open={pendingOpen != null}
        onOpenChange={(o) => !o && setPendingOpen(null)}
        title={`Leave question ${currentLetter ?? ''}?`}
        description={`You won't be able to come back to question ${currentLetter ?? ''}. Code you have not submitted will not be judged.`}
        confirmLabel={`Open question ${pendingOpen?.letter ?? ''}`}
        cancelLabel="Stay"
        onConfirm={() => {
          const target = pendingOpen;
          setPendingOpen(null);
          if (target) navigate(`/contests/${id}/q/${target.letter}`);
        }}
      />
    </AppShell>
  );
}
