import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { PracticeWorkspaceDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { AppShell, Wordmark } from '../../components/AppShell';
import { ErrorNote, Spinner } from '../../components/ui';
import { Workspace } from '../../components/workspace/Workspace';
import { FromContest } from '../../components/FromContest';

export default function PracticeSolvePage() {
  const { slug } = useParams();
  const user = useUser();
  const base = `/api/practice/questions/${encodeURIComponent(slug ?? '')}`;
  const question = useQuery({
    queryKey: ['practice-question', slug],
    queryFn: () => api.get<PracticeWorkspaceDTO>(base),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (question.isPending) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (question.error) {
    return (
      <AppShell>
        <ErrorNote>{errorMessage(question.error)}</ErrorNote>
        <Link to="/practice" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Back to practice
        </Link>
      </AppShell>
    );
  }
  const q = question.data;
  return (
    <Workspace
      key={q.id}
      question={q}
      scope={`u${user?.id ?? 0}:practice:${q.id}`}
      endpoints={{ draft: `${base}/draft`, run: `${base}/run`, submit: `${base}/submit`, submissions: `${base}/submissions` }}
      bar={
        <div className="flex min-w-0 items-center gap-3">
          <Wordmark />
          <Link to="/practice" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
            <ArrowLeft className="size-3.5" /> Practice
          </Link>
          <span aria-hidden className="h-4 w-px bg-line" />
          <h1 className="truncate text-sm font-semibold">{q.title}</h1>
          <FromContest contests={q.fromContests} className="hidden shrink-0 md:inline-flex" />
        </div>
      }
    />
  );
}
