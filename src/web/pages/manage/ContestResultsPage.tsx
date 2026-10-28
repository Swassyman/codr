import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { LANGUAGES } from '../../../shared/languages';
import type { ContestResultsDTO, SubmissionDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { formatWhen } from '../../lib/format';
import { cn } from '../../lib/cn';
import { AppShell } from '../../components/AppShell';
import { Button, Dialog, EmptyState, ErrorNote, PageHeader, Spinner } from '../../components/ui';
import { VerdictBadge, formatKb, formatMs } from '../../components/verdict';

type Person = ContestResultsDTO['participants'][number];

function CodeView({ id }: { id: number }) {
  const sub = useQuery({ queryKey: ['submission', id, 'code'], queryFn: () => api.get<SubmissionDTO>(`/api/submissions/${id}`) });
  if (sub.isPending) return <Spinner />;
  if (sub.error) return <ErrorNote>{errorMessage(sub.error)}</ErrorNote>;
  return <pre className="max-h-80 overflow-auto rounded-md border border-line bg-well p-3 font-mono text-xs">{sub.data.code}</pre>;
}

function PersonDialog({ contestId, person, results, onClose }: { contestId: number; person: Person; results: ContestResultsDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const now = Date.now();
  const [openCode, setOpenCode] = useState<number | null>(null);
  const subs = useQuery({
    queryKey: ['contest-person-subs', contestId, person.userId],
    queryFn: () => api.get<{ submissions: (SubmissionDTO & { userId: number })[] }>(`/api/manage/contests/${contestId}/submissions?userId=${person.userId}`),
  });
  const integrity = useQuery({
    queryKey: ['contest-integrity', contestId, person.userId],
    queryFn: () => api.get<{ events: { type: string; questionId: number | null; at: string; chars: number | null }[] }>(`/api/manage/contests/${contestId}/integrity?userId=${person.userId}`),
    enabled: results.contest.recordIntegrity,
  });
  const rejudge = useMutation({
    mutationFn: (id: number) => api.post(`/api/manage/submissions/${id}/rejudge`),
    onSuccess: () => {
      toast.success('Queued for judging again.');
      void qc.invalidateQueries({ queryKey: ['contest-person-subs', contestId, person.userId] });
      void qc.invalidateQueries({ queryKey: ['contest-results', contestId] });
    },
  });
  const letterOf = (qid: number | null) => results.questions.find((q) => q.questionId === qid)?.letter ?? '—';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={person.displayName} description={`${person.username}${person.isGuest ? ' (guest)' : ''}. Started ${person.enteredAt ? formatWhen(person.enteredAt, now) : 'never'}${person.finishedAt ? `, finished ${formatWhen(person.finishedAt, now)}` : ''}.`} wide>
      <h3 className="mb-2 text-sm font-semibold">Submissions</h3>
      {subs.isPending ? (
        <Spinner />
      ) : (subs.data?.submissions.length ?? 0) === 0 ? (
        <p className="text-sm text-ink-3">No submissions.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {subs.data!.submissions.map((s) => (
            <li key={s.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-5 font-mono font-semibold">{letterOf(s.questionId)}</span>
                {s.status === 'done' ? <VerdictBadge verdict={s.verdict ?? 'IE'} /> : <span className="text-ink-3">{s.status}</span>}
                <span className="tabular-nums">{s.score ?? '—'} / {s.maxScore}</span>
                <span className="text-ink-2 tabular-nums">{formatMs(s.timeMs)}</span>
                <span className="text-ink-2 tabular-nums">{formatKb(s.memoryKb)}</span>
                <span className="text-ink-3">{LANGUAGES[s.language].label}</span>
                {s.isAuto && <span className="text-ink-3">sent at time-out</span>}
                <span className="ml-auto text-xs text-ink-3">{formatWhen(s.receivedAt, now)}</span>
                <Button size="sm" variant="ghost" onClick={() => setOpenCode(openCode === s.id ? null : s.id)}>
                  {openCode === s.id ? 'Hide code' : 'Code'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => rejudge.mutate(s.id)}>
                  Rejudge
                </Button>
              </div>
              {openCode === s.id && (
                <div className="mt-2">
                  <CodeView id={s.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {results.contest.recordIntegrity && (
        <>
          <h3 className="mt-6 mb-1 text-sm font-semibold">Integrity signals</h3>
          <p className="mb-2 text-xs text-ink-3">Informational only. Switching tabs or pasting is not proof of anything.</p>
          {(integrity.data?.events.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-3">Nothing recorded.</p>
          ) : (
            <ol className="max-h-60 overflow-y-auto rounded-md border border-line text-sm">
              {integrity.data!.events.map((e, i) => (
                <li key={i} className="flex gap-4 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="w-20 text-ink-3 tabular-nums">{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="w-24">{e.type === 'blur' ? 'Left the tab' : e.type === 'focus' ? 'Came back' : 'Pasted'}</span>
                  <span className="text-ink-2">
                    {e.questionId ? `question ${letterOf(e.questionId)}` : ''}
                    {e.chars != null ? `, ${e.chars} characters` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Dialog>
  );
}

export default function ContestResultsPage() {
  const id = Number(useParams().id);
  const [person, setPerson] = useState<Person | null>(null);
  const results = useQuery({
    queryKey: ['contest-results', id],
    queryFn: () => api.get<ContestResultsDTO>(`/api/manage/contests/${id}/results`),
    refetchInterval: 15_000,
  });
  const now = Date.now();
  const r = results.data;

  return (
    <AppShell wide>
      <Link to={`/manage/contests/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Contest settings
      </Link>
      <PageHeader title={r ? `Results: ${r.contest.name}` : 'Results'} description="Live from judged submissions. Click a person for their submissions and integrity signals." />
      {results.isPending ? (
        <Spinner />
      ) : results.error ? (
        <ErrorNote>{errorMessage(results.error)}</ErrorNote>
      ) : r!.participants.length === 0 ? (
        <EmptyState title="Nobody has joined yet.">Share the contest link or the join code from the contest settings.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-3 text-right font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Participant</th>
                <th className="py-2 pr-4 text-right font-medium">Score</th>
                {r!.contest.penaltyMinutes != null && <th className="py-2 pr-4 text-right font-medium">Penalty</th>}
                {r!.questions.map((q) => (
                  <th key={q.questionId} className="py-2 pr-3 text-center font-mono font-semibold" title={q.title}>
                    {q.letter}
                  </th>
                ))}
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 font-medium">Finished</th>
                {r!.contest.recordIntegrity && <th className="py-2 font-medium">Tab switches / pastes</th>}
              </tr>
            </thead>
            <tbody>
              {r!.participants.map((p) => (
                <tr key={p.participantId} className="cursor-pointer border-b border-line hover:bg-raised" onClick={() => setPerson(p)}>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-ink-2">{p.rank}</td>
                  <td className="py-2.5 pr-4">
                    <button type="button" className="font-medium hover:text-accent" onClick={() => setPerson(p)}>
                      {p.displayName}
                    </button>
                    <span className="ml-2 text-xs text-ink-3">{p.username}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">{p.score}</td>
                  {r!.contest.penaltyMinutes != null && <td className="py-2.5 pr-4 text-right tabular-nums text-ink-2">{p.penalty}</td>}
                  {p.questions.map((q) => (
                    <td key={q.questionId} className="py-2.5 pr-3 text-center tabular-nums">
                      {q.attempts === 0 ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <span className={cn('inline-flex min-w-12 flex-col rounded px-1.5 py-0.5', q.solved ? 'bg-ok-soft text-ok' : q.score > 0 ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad')}>
                          <span className="font-semibold">{q.score}</span>
                          <span className="text-[11px] opacity-80">{q.attempts} {q.attempts === 1 ? 'try' : 'tries'}</span>
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="py-2.5 pr-4 whitespace-nowrap text-ink-2">{p.enteredAt ? formatWhen(p.enteredAt, now) : '—'}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-ink-2">{p.finishedAt ? formatWhen(p.finishedAt, now) : '—'}</td>
                  {r!.contest.recordIntegrity && (
                    <td className={cn('py-2.5 tabular-nums', p.integrity.blurs + p.integrity.pastes > 0 ? 'text-ink' : 'text-ink-3')}>
                      {p.integrity.blurs} / {p.integrity.pastes}
                      {p.integrity.pastedChars > 0 && <span className="ml-1 text-xs text-ink-3">({p.integrity.pastedChars} chars)</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {person && r && <PersonDialog contestId={id} person={person} results={r} onClose={() => setPerson(null)} />}
    </AppShell>
  );
}
