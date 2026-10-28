import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { ContestListItemDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { formatWhen } from '../../lib/format';
import { AppShell } from '../../components/AppShell';
import { Button, EmptyState, ErrorNote, PageHeader, Spinner } from '../../components/ui';
import { StatusPill } from './QuestionsPage';

export const modeLabel = { fixed_window: 'Fixed window', personal_window: 'Personal window', per_question: 'Timer per question' } as const;
const phaseLabel = { upcoming: 'Upcoming', live: 'Live', ended: 'Ended' } as const;

export default function ContestsManagePage() {
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['manage-contests'], queryFn: () => api.get<{ contests: ContestListItemDTO[] }>('/api/manage/contests') });
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/manage/contests'),
    onSuccess: ({ id }) => navigate(`/manage/contests/${id}`),
  });
  const now = Date.now();
  const contests = list.data?.contests ?? [];

  return (
    <AppShell>
      <PageHeader
        title="Contest builder"
        description="Pick questions from the bank, set the timing rules, and publish."
        actions={
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
            <Plus className="size-4" /> New contest
          </Button>
        }
      />
      {create.error && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote>{errorMessage(list.error)}</ErrorNote>
      ) : contests.length === 0 ? (
        <EmptyState title="No contests yet." action={<Button variant="primary" onClick={() => create.mutate()}>Create a contest</Button>}>
          You need published questions first. Write them in the question bank, then add them here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-4 font-medium">Contest</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Timing</th>
                <th className="py-2 pr-4 font-medium">Window</th>
                <th className="py-2 pr-4 text-right font-medium">Questions</th>
                <th className="py-2 pr-4 text-right font-medium">People</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {contests.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <td className="py-3 pr-4">
                    <Link to={`/manage/contests/${c.id}`} className="font-medium text-ink hover:text-accent">
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusPill status={c.status} />
                    {c.status === 'published' && <span className="ml-2 text-xs text-ink-3">{phaseLabel[c.phase]}</span>}
                  </td>
                  <td className="py-3 pr-4 text-ink-2">{modeLabel[c.timingMode]}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-ink-2 tabular-nums">
                    {formatWhen(c.startsAt, now)} to {formatWhen(c.endsAt, now)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.questionCount}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{c.participantCount}</td>
                  <td className="py-3 text-right">
                    <Link to={`/manage/contests/${c.id}/results`} className="text-sm font-medium text-accent hover:underline">
                      Results
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
