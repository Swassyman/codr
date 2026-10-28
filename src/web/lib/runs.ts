import { useQuery } from '@tanstack/react-query';
import type { RunDTO } from '../../shared/api';
import { api } from './api';

/** A run's status; refreshed by SSE and, as a fallback, by polling while unfinished. */
export function useRun(runId: number | null) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<RunDTO>(`/api/runs/${runId}`),
    enabled: runId != null,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'done' || status === 'failed' ? false : 1500;
    },
  });
}

export const isFinished = (run: RunDTO | undefined) => run?.status === 'done' || run?.status === 'failed';
