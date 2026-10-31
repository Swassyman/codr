import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { QuestionListItemDTO, ValidationState } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { formatWhen } from '../../lib/format';
import { cn } from '../../lib/cn';
import { AppShell } from '../../components/AppShell';
import { Button, EmptyState, ErrorNote, Input, PageHeader, Spinner } from '../../components/ui';

export const validationBadge: Record<ValidationState, { label: string; className: string }> = {
  passed: { label: 'Validated', className: 'bg-ok-soft text-ok' },
  failed: { label: 'Validation failed', className: 'bg-bad-soft text-bad' },
  stale: { label: 'Re-validate', className: 'bg-warn-soft text-warn' },
  missing: { label: 'Not validated', className: 'bg-raised text-ink-3' },
};

const difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

export function StatusPill({ status }: { status: 'draft' | 'published' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 text-xs font-medium',
        status === 'published' ? 'bg-accent-soft text-accent' : 'bg-raised text-ink-2',
      )}
    >
      {status === 'published' ? 'Published' : 'Draft'}
    </span>
  );
}

export default function QuestionsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['manage-questions', search],
    queryFn: () => api.get<{ questions: QuestionListItemDTO[] }>(`/api/manage/questions${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/manage/questions', {}),
    onSuccess: ({ id }) => navigate(`/manage/questions/${id}`),
  });
  const now = Date.now();
  const questions = list.data?.questions ?? [];

  return (
    <AppShell>
      <PageHeader
        title="Question bank"
        description="Write questions once and reuse them across contests and practice."
        actions={
          <>
            <Link to="/manage/import" className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-raised">
              Import
            </Link>
            <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
              <Plus className="size-4" /> New question
            </Button>
          </>
        }
      />
      {create.error && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input aria-label="Search questions" placeholder="Search by title, slug or tag" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote>{errorMessage(list.error)}</ErrorNote>
      ) : questions.length === 0 ? (
        search ? (
          <EmptyState title={`Nothing matches "${search}".`}>Try a different word, or clear the search.</EmptyState>
        ) : (
          <EmptyState
            title="Your question bank is empty."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => create.mutate()}>
                  Write a question
                </Button>
                <Link to="/manage/import" className="inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-sm font-medium hover:bg-raised">
                  Import from a dataset
                </Link>
              </div>
            }
          >
            Start with a statement and a few test cases. You can generate expected outputs from a reference solution.
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-4 font-medium">Question</th>
                <th className="py-2 pr-4 font-medium">Difficulty</th>
                <th className="py-2 pr-4 text-right font-medium">Tests</th>
                <th className="py-2 pr-4 font-medium">Validation</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 text-right font-medium">Contests</th>
                <th className="py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className="border-b border-line align-top">
                  <td className="py-3 pr-4">
                    {q.canEdit ? (
                      <Link to={`/manage/questions/${q.id}`} className="font-medium text-ink hover:text-accent">
                        {q.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{q.title}</span>
                    )}
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
                      <span className="font-mono">{q.slug}</span>
                      {q.tags.length > 0 && <span>{q.tags.join(', ')}</span>}
                      {!q.canEdit && q.authorName && <span>by {q.authorName}</span>}
                      {q.source && <span>imported from {q.source.adapter}</span>}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-ink-2">
                    {q.difficulty ? difficultyLabel[q.difficulty] : '—'}
                    {q.rating != null && <span className="ml-1 text-ink-3 tabular-nums">{q.rating}</span>}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{q.testCount}</td>
                  <td className="py-3 pr-4">
                    <span className={cn('inline-flex h-5 items-center rounded px-1.5 text-xs font-medium', validationBadge[q.validationState].className)}>
                      {validationBadge[q.validationState].label}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusPill status={q.status} />
                    {q.practiceHidden ? (
                      <span className="ml-1.5 text-xs text-ink-3">kept out of practice</span>
                    ) : (
                      q.practice && <span className="ml-1.5 text-xs text-ink-3">practice</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-2">{q.usedIn || '—'}</td>
                  <td className="py-3 whitespace-nowrap text-ink-2">{formatWhen(q.updatedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
