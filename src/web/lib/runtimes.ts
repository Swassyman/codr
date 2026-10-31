import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RuntimesResponse } from '../../shared/api';
import { languageLabel, type LanguageId } from '../../shared/languages';
import { api } from './api';

/** Languages the runner can execute right now, and their installed versions. */
export function useRuntimes() {
  const query = useQuery({
    queryKey: ['runtimes'],
    queryFn: () => api.get<RuntimesResponse>('/api/runtimes'),
    staleTime: 60_000,
  });
  const installed = new Set<LanguageId>((query.data?.languages ?? []).map((l) => l.id));
  return { ...query, installed };
}

/**
 * Names a language with the version the runner has installed, e.g.
 * "C++17 (gcc 10.2.0)"; "C++17 (gcc)" until the version is known.
 */
export function useLanguageLabel() {
  const { data } = useRuntimes();
  const versions = data?.versions;
  return useCallback((language: LanguageId) => languageLabel(language, versions?.[language]), [versions]);
}
