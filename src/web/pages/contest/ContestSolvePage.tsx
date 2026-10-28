import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { letterIndex } from '../../../shared/letters';
import type { ContestQuestionDTO, ContestQuestionStateDTO } from '../../../shared/api';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { useContestLobby, useContestState, useIntegrityTracker } from '../../lib/contest';
import { serverClock } from '../../lib/server-time';
import { Wordmark, ThemeToggle } from '../../components/AppShell';
import { ContestClock, Fuse } from '../../components/contest/Clock';
import { Navigator } from '../../components/contest/Navigator';
import { Button, ConfirmDialog, Dialog, Spinner } from '../../components/ui';
import { Workspace } from '../../components/workspace/Workspace';

export default function ContestSolvePage() {
  const params = useParams();
  const id = Number(params.id);
  const letter = (params.letter ?? 'A').toUpperCase();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useUser();
  const lobby = useContestLobby(id);
  const state = useContestState(id, true);
  const c = lobby.data;
  const s = state.data;
  const slot = s?.questions[letterIndex(letter)];
  const questionId = slot?.questionId ?? null;

  // The only request that reveals a statement; it records the view on the server.
  const opened = useQuery({
    queryKey: ['contest-open', id, questionId],
    queryFn: () => api.post<ContestQuestionDTO>(`/api/contests/${id}/questions/${questionId}/open`),
    enabled: questionId != null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (opened.data) void qc.invalidateQueries({ queryKey: ['contest-state', id] });
  }, [opened.data, qc, id]);

  const [pendingNav, setPendingNav] = useState<{ to: string; label: string; leave: boolean } | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [timeUpFor, setTimeUpFor] = useState<number | null>(null);

  const integrity = useIntegrityTracker(id, !!c?.recordIntegrity, questionId);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contest-state', id] });
    void qc.invalidateQueries({ queryKey: ['contest', id] });
  };

  const finish = useMutation({
    mutationFn: () => api.post(`/api/contests/${id}/finish`),
    onSuccess: () => {
      refresh();
      navigate(`/contests/${id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const leave = useMutation({ mutationFn: (qid: number) => api.post(`/api/contests/${id}/questions/${qid}/leave`) });

  // Per-question mode: when this question's time is up, offer the next one.
  const live = s?.questions.find((q) => q.questionId === questionId);
  const deadline = c?.timingMode === 'per_question' ? (live?.deadline ?? opened.data?.deadline ?? null) : (s?.participantDeadline ?? null);
  const fuseStart =
    c?.timingMode === 'per_question' ? (live?.firstViewedAt ?? null) : c?.timingMode === 'personal_window' ? (c.participant?.enteredAt ?? null) : (c?.startsAt ?? null);
  const expiredLocally = deadline != null && Date.parse(deadline) <= serverClock.now();
  const lockedMessage = useMemo(() => {
    if (s?.over) return s.lock?.message ?? 'Your contest is over.';
    if (live && live.state === 'locked') return live.reason ?? 'This question is locked.';
    if (expiredLocally) return 'Time is up. Waiting for the server to confirm.';
    return null;
  }, [s, live, expiredLocally]);

  const onExpire = () => {
    refresh();
    if (c?.timingMode === 'per_question' && questionId != null) setTimeUpFor(questionId);
  };

  const go = (q: ContestQuestionStateDTO) => {
    const to = `/contests/${id}/q/${q.letter}`;
    const currentOpen = live?.state === 'open';
    if (c?.viewOnce && currentOpen) setPendingNav({ to, label: `Open question ${q.letter}`, leave: false });
    else navigate(to);
  };
  const toOverview = () => {
    const to = `/contests/${id}`;
    if (c?.viewOnce && live?.state === 'open') setPendingNav({ to, label: 'Leave and go to the overview', leave: true });
    else navigate(to);
  };

  const nextAvailable = s?.questions.find((q) => q.questionId !== questionId && (q.state === 'available' || q.state === 'open'));

  const bar = (
    <div className="flex min-w-0 items-center gap-3">
      <Wordmark />
      <button type="button" onClick={toOverview} className="inline-flex items-center gap-1 truncate text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5 shrink-0" /> <span className="truncate">{c?.name ?? 'Contest'}</span>
      </button>
      <span aria-hidden className="h-4 w-px bg-line" />
      {s && <Navigator questions={s.questions} activeId={questionId} onSelect={go} />}
    </div>
  );
  const barRight = (
    <>
      {deadline && !s?.over && (
        <ContestClock deadline={deadline} label={c?.timingMode === 'per_question' ? `Time left for question ${letter}` : 'Time left in the contest'} onExpire={onExpire} />
      )}
      {!s?.over && (
        <Button size="sm" variant="ghost" onClick={() => setConfirmFinish(true)}>
          Finish
        </Button>
      )}
    </>
  );

  const dialogs = (
    <>
      <ConfirmDialog
        open={pendingNav != null}
        onOpenChange={(o) => !o && setPendingNav(null)}
        title={`Leave question ${letter}?`}
        description={`You won't be able to come back to question ${letter}. Code you have not submitted will not be judged.`}
        confirmLabel={pendingNav?.label ?? 'Leave'}
        cancelLabel="Stay"
        onConfirm={async () => {
          const target = pendingNav;
          setPendingNav(null);
          if (!target) return;
          if (target.leave && questionId != null) await leave.mutateAsync(questionId).catch(() => null);
          refresh();
          navigate(target.to);
        }}
      />
      <ConfirmDialog
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title="Finish the contest?"
        description="Every question locks and you cannot submit anything else. Submissions already sent are still judged."
        confirmLabel="Finish contest"
        tone="danger"
        loading={finish.isPending}
        onConfirm={() => finish.mutate()}
      />
      <Dialog open={timeUpFor != null && timeUpFor === questionId} onOpenChange={(o) => !o && setTimeUpFor(null)} title={`Time is up for question ${letter}`}>
        <p className="text-sm text-ink-2">The question is locked. If you had code in the editor, your last saved version was submitted for you.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => navigate(`/contests/${id}`)}>Overview</Button>
          {nextAvailable ? (
            <Button variant="primary" onClick={() => navigate(`/contests/${id}/q/${nextAvailable.letter}`)}>
              Go to question {nextAvailable.letter}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setConfirmFinish(true)}>
              Finish contest
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );

  if (lobby.isPending || state.isPending || (questionId != null && opened.isPending)) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const refusal = state.error ?? opened.error ?? (slot ? null : new Error('That question is not part of this contest.'));
  if (refusal || !opened.data) {
    return (
      <div className="flex h-dvh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
          {bar}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto mt-[12vh] max-w-md px-4 text-center">
          <Lock className="mx-auto size-6 text-ink-3" />
          <h1 className="mt-3 text-xl font-semibold">Question {letter} is not available</h1>
          <p className="mt-2 text-ink-2">{refusal ? errorMessage(refusal) : 'This question cannot be opened.'}</p>
          <Link to={`/contests/${id}`} className="mt-5 inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-sm font-medium hover:bg-raised">
            Back to the overview
          </Link>
        </main>
        {dialogs}
      </div>
    );
  }

  const q = opened.data;
  const base = `/api/contests/${id}/questions/${q.id}`;
  return (
    <>
      <Workspace
        key={q.id}
        question={q}
        scope={`u${user?.id ?? 0}:contest-${id}:${q.id}`}
        endpoints={{ draft: `${base}/draft`, run: `${base}/run`, submit: `${base}/submit`, submissions: `${base}/submissions` }}
        bar={bar}
        barRight={barRight}
        fuse={<Fuse start={fuseStart} deadline={s?.over ? null : deadline} />}
        locked={lockedMessage}
        deadline={deadline}
        submissionLimit={q.maxSubmissions ? { used: live?.submissionsUsed ?? q.submissionsUsed, max: q.maxSubmissions } : null}
        onPaste={(chars) => integrity.recordPaste(chars)}
        onRefused={(err: ApiError) => {
          refresh();
          if (err.code === 'question_expired' && c?.timingMode === 'per_question') setTimeUpFor(q.id);
        }}
      />
      {dialogs}
    </>
  );
}
