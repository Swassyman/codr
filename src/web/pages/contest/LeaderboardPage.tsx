import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { LeaderboardDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { formatWhen } from '../../lib/format';
import { AppShell } from '../../components/AppShell';
import { ErrorNote, Notice, PageHeader, Spinner } from '../../components/ui';

/**
 * Minimal leaderboard, shipped behind FEATURE_LEADERBOARD_UI. The standings
 * API (aggregation, ranks, penalty, freeze) is complete; this page is a stub
 * to build on.
 */
export default function LeaderboardPage() {
  const id = Number(useParams().id);
  const me = useMe();
  const enabled = !!me.data?.features.leaderboardUi;
  const board = useQuery({
    queryKey: ['leaderboard', id],
    queryFn: () => api.get<LeaderboardDTO>(`/api/contests/${id}/leaderboard`),
    enabled,
    refetchInterval: 30_000,
  });

  return (
    <AppShell>
      <Link to={`/contests/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Contest
      </Link>
      <PageHeader title="Leaderboard" />
      {!enabled ? (
        <Notice>The leaderboard is turned off on this server.</Notice>
      ) : board.isPending ? (
        <Spinner />
      ) : board.error ? (
        <ErrorNote>{errorMessage(board.error)}</ErrorNote>
      ) : (
        <>
          {board.data.frozenAt && <Notice className="mb-4">Frozen at {formatWhen(board.data.frozenAt, Date.now())}. Later submissions show after the contest.</Notice>}
          <table className="w-full max-w-3xl text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-3 text-right font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Participant</th>
                <th className="py-2 pr-4 text-right font-medium">Score</th>
                {board.data.questions.map((q) => (
                  <th key={q.questionId} className="py-2 pr-3 text-center font-mono" title={q.title}>
                    {q.letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.data.rows.map((r) => (
                <tr key={r.participantId} className="border-b border-line">
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{r.rank}</td>
                  <td className="py-2 pr-4">{r.displayName}</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{r.score}</td>
                  {r.questions.map((q) => (
                    <td key={q.questionId} className={`py-2 pr-3 text-center tabular-nums ${q.solved ? 'text-ok' : q.attempts ? 'text-ink-2' : 'text-ink-3'}`}>
                      {q.attempts ? q.score : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </AppShell>
  );
}
