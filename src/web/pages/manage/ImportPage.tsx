import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { AppShell } from '../../components/AppShell';
import { Button, ErrorNote, Input, Notice, PageHeader, Spinner } from '../../components/ui';

interface SourceInfo {
  id: string;
  name: string;
  kind: 'dataset' | 'metadata' | 'scraper';
  description: string;
  licenseNote: string;
  provides: { statement: boolean; tests: boolean; solution: boolean };
}

interface Result {
  externalId: string;
  title: string;
  url: string | null;
  rating: number | null;
  tags: string[];
  detail: string | null;
  importedQuestionId: number | null;
}

const kindLabel = { dataset: 'Open dataset', metadata: 'Metadata and link', scraper: 'Best effort' } as const;

function Provides({ s }: { s: SourceInfo }) {
  const items = [
    ['Statement', s.provides.statement],
    ['Tests', s.provides.tests],
    ['Solution', s.provides.solution],
  ] as const;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map(([label, ok]) => (
        <span key={label} className={cn('rounded px-1.5 text-xs', ok ? 'bg-ok-soft text-ok' : 'bg-raised text-ink-3 line-through')}>
          {label}
        </span>
      ))}
    </span>
  );
}

export default function ImportPage() {
  const navigate = useNavigate();
  const sources = useQuery({ queryKey: ['import-sources'], queryFn: () => api.get<{ sources: SourceInfo[] }>('/api/manage/import/sources') });
  const [sourceId, setSourceId] = useState('code-contests');
  const [text, setText] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [extraTests, setExtraTests] = useState(10);
  const source = sources.data?.sources.find((s) => s.id === sourceId);

  const results = useQuery({
    queryKey: ['import-search', sourceId, query],
    queryFn: () => api.get<{ results: Result[]; note: string | null }>(`/api/manage/import/${sourceId}/search?q=${encodeURIComponent(query ?? '')}`),
    enabled: query !== null,
    retry: false,
    staleTime: 60_000,
  });

  const importOne = useMutation({
    mutationFn: (externalId: string) =>
      api.post<{ id: number; existed: boolean }>(`/api/manage/import/${sourceId}/import`, { externalId, ...(sourceId === 'code-contests' ? { extraTests } : {}) }),
    onSuccess: ({ id, existed }) => {
      toast.success(existed ? 'Already imported. Opening the draft.' : 'Imported as a draft. Review it before publishing.');
      navigate(`/manage/questions/${id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(text.trim());
  };

  return (
    <AppShell>
      <PageHeader
        title="Import questions"
        description="Bring problems in from open datasets and problem archives. Every import lands as a draft in the question bank, with its source and license kept on the record."
      />
      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Source">
          {sources.isPending && <Spinner />}
          {sources.data?.sources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === sourceId}
              onClick={() => {
                setSourceId(s.id);
                setQuery(null);
              }}
              className={cn('flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left', s.id === sourceId ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-raised')}
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-ink-3">{kindLabel[s.kind]}</span>
              <Provides s={s} />
            </button>
          ))}
          <Notice className="mt-4 text-xs">
            Respect each source's license. Codr keeps attribution and the original link on every imported question. Do not republish scraped statements publicly.
          </Notice>
        </div>

        <div className="min-w-0">
          {source && (
            <div className="mb-4">
              <p className="text-sm text-ink-2">{source.description}</p>
              <p className="mt-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <span className="font-medium">License: </span>
                {source.licenseNote}
              </p>
            </div>
          )}
          <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                aria-label="Search the source"
                className="pl-9"
                placeholder={sourceId === 'codeforces' ? 'Name, tag or id like 1575A' : sourceId === 'atcoder' ? 'Name or task id like abc300_a' : 'Search by name or tag'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            {sourceId === 'code-contests' && (
              <label className="flex items-center gap-2 text-sm text-ink-2">
                Extra generated tests
                <Input type="number" min={0} max={100} className="w-20" value={extraTests} onChange={(e) => setExtraTests(Number(e.target.value))} />
              </label>
            )}
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>

          {query === null ? (
            <p className="text-sm text-ink-3">Search to see problems. An empty search lists the first ones. The first search may take a few seconds while the source index downloads.</p>
          ) : results.isPending ? (
            <p className="inline-flex items-center gap-2 text-sm text-ink-2">
              <Spinner /> Asking {source?.name ?? 'the source'}
            </p>
          ) : results.error ? (
            <ErrorNote>{errorMessage(results.error)} You can still create a question by hand and paste the statement.</ErrorNote>
          ) : results.data!.results.length === 0 ? (
            <p className="text-sm text-ink-2">No matches. Try a shorter word or a tag.</p>
          ) : (
            <>
              {results.data!.note && <p className="mb-2 text-xs text-ink-3">{results.data!.note}</p>}
              <ul className="divide-y divide-line border-y border-line">
                {results.data!.results.map((r) => (
                  <li key={r.externalId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {r.title}
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer noopener" className="ml-2 inline-flex items-center text-ink-3 hover:text-accent" aria-label={`Open ${r.title} at the source`}>
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </p>
                      <p className="flex flex-wrap gap-x-3 text-xs text-ink-3">
                        {r.detail && <span>{r.detail}</span>}
                        {r.rating != null && <span>Rating {r.rating}</span>}
                        {r.tags.length > 0 && <span>{r.tags.join(', ')}</span>}
                      </p>
                    </div>
                    {r.importedQuestionId ? (
                      <Link to={`/manage/questions/${r.importedQuestionId}`} className="text-sm font-medium text-accent hover:underline">
                        Imported, open draft
                      </Link>
                    ) : (
                      <Button size="sm" loading={importOne.isPending && importOne.variables === r.externalId} onClick={() => importOne.mutate(r.externalId)}>
                        Import as draft
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
