import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDot, Search } from 'lucide-react';
import type { PracticeQuestionDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { AppShell } from '../../components/AppShell';
import { EmptyState, ErrorNote, Input, PageHeader, Spinner } from '../../components/ui';

const difficultyLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

export default function PracticeListPage() {
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['practice', search],
    queryFn: () => api.get<{ questions: PracticeQuestionDTO[] }>(`/api/practice/questions${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const questions = list.data?.questions ?? [];
  const solved = questions.filter((q) => q.solved).length;

  return (
    <AppShell>
      <PageHeader title="Practice" description="Solve questions from the bank at your own pace. No timers, unlimited submissions." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Search practice questions" placeholder="Search by title or tag" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {questions.length > 0 && (
          <p className="text-sm text-ink-2 tabular-nums">
            {solved} of {questions.length} solved
          </p>
        )}
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote>{errorMessage(list.error)}</ErrorNote>
      ) : questions.length === 0 ? (
        <EmptyState title={search ? `Nothing matches "${search}".` : 'No practice questions yet.'}>
          {search ? 'Try another word.' : 'Organizers choose which published questions appear here. Questions in an unfinished contest stay hidden until it ends.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {questions.map((q) => (
            <li key={q.id}>
              <Link to={`/practice/${q.slug}`} className="flex items-center gap-4 px-1 py-3 hover:bg-raised">
                <span className="w-5" aria-label={q.solved ? 'Solved' : q.attempted ? 'Attempted' : 'Not attempted'}>
                  {q.solved ? <CircleCheck className="size-4 text-ok" /> : q.attempted ? <CircleDot className="size-4 text-warn" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{q.title}</span>
                  {q.tags.length > 0 && <span className="ml-3 text-xs text-ink-3">{q.tags.join(', ')}</span>}
                </span>
                <span className="text-sm text-ink-2">{q.difficulty ? difficultyLabel[q.difficulty] : ''}</span>
                <span className="w-12 text-right text-sm text-ink-3 tabular-nums">{q.rating ?? ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
