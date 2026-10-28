import { useQuery } from '@tanstack/react-query';
import type { RuntimesResponse } from '../../shared/api';
import type { LanguageId } from '../../shared/languages';
import { api } from './api';

/** Languages the runner can execute right now. */
export function useRuntimes() {
  const query = useQuery({
    queryKey: ['runtimes'],
    queryFn: () => api.get<RuntimesResponse>('/api/runtimes'),
    staleTime: 60_000,
  });
  const installed = new Set<LanguageId>((query.data?.languages ?? []).map((l) => l.id));
  return { ...query, installed };
}
