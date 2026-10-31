import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { questionFieldsSchema, type QuestionFields } from '../../../../shared/schemas';
import type { QuestionEditorDTO } from '../../../../shared/api';
import { api, ApiError, errorMessage } from '../../../lib/api';
import { useAutosave } from '../../../lib/autosave';
import { AppShell } from '../../../components/AppShell';
import { SaveIndicator } from '../../../components/form-bits';
import { Button, ConfirmDialog, ErrorNote, Notice, Spinner, Tab, TabList, TabPanel, Tabs } from '../../../components/ui';
import { StatusPill } from '../QuestionsPage';
import { StatementTab } from './StatementTab';
import { TestsTab } from './TestsTab';
import { SettingsTab } from './SettingsTab';
import { ValidateTab } from './ValidateTab';

export type QuestionForm = QuestionFields;

export interface TabProps {
  values: QuestionForm;
  update: (patch: Partial<QuestionForm>) => void;
  /** Reflect a value the server already saved, without sending it again. */
  setLocal: (patch: Partial<QuestionForm>) => void;
  errors: Record<string, string>;
  /** The method of a function-style question; null for ordinary (standard input) questions. */
  functionSpec?: QuestionEditorDTO['functionSpec'];
}

function pickFields(q: QuestionEditorDTO): QuestionForm {
  return {
    title: q.title,
    slug: q.slug,
    difficulty: q.difficulty,
    rating: q.rating,
    tags: q.tags,
    statement: q.statement,
    inputFormat: q.inputFormat,
    outputFormat: q.outputFormat,
    constraints: q.constraints,
    samples: q.samples,
    notes: q.notes,
    timeLimitMs: q.timeLimitMs,
    memoryLimitMb: q.memoryLimitMb,
    languageLimits: q.languageLimits,
    allowedLanguages: q.allowedLanguages,
    starterCode: q.starterCode,
    points: q.points,
    scoringMode: q.scoringMode,
    checker: q.checker,
    referenceSolution: q.referenceSolution,
    practice: q.practice,
    practiceHidden: q.practiceHidden,
  };
}

function Editor({ question }: { question: QuestionEditorDTO }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'statement';
  const id = question.id;

  const autosave = useAutosave<QuestionForm>({
    initial: pickFields(question),
    shape: questionFieldsSchema.shape,
    save: async (patch) => {
      const updated = await api.patch<QuestionEditorDTO>(`/api/manage/questions/${id}`, patch);
      qc.setQueryData(['question', id], updated);
    },
  });
  const meta = useQuery({ queryKey: ['question', id], queryFn: () => api.get<QuestionEditorDTO>(`/api/manage/questions/${id}`), initialData: question }).data;

  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [publishProblems, setPublishProblems] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const publish = useMutation({
    mutationFn: async (acknowledgeValidation: boolean) => {
      await autosave.flush();
      return api.post(`/api/manage/questions/${id}/publish`, { acknowledgeValidation });
    },
    onSuccess: () => {
      setConfirmPublish(null);
      setPublishProblems([]);
      toast.success('Published. Add it to a contest from the contest builder.');
      void qc.invalidateQueries({ queryKey: ['question', id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'validation_needed') setConfirmPublish(err.message);
      else if (err instanceof ApiError && err.code === 'not_ready') setPublishProblems(Object.values(err.fieldErrors));
      else toast.error(errorMessage(err));
    },
  });
  const unpublish = useMutation({
    mutationFn: () => api.post(`/api/manage/questions/${id}/unpublish`),
    onSuccess: () => {
      toast.success('Moved back to draft.');
      void qc.invalidateQueries({ queryKey: ['question', id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/manage/questions/${id}`),
    onSuccess: () => {
      toast.success('Question deleted.');
      navigate('/manage/questions');
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(errorMessage(err));
    },
  });

  const tabProps: TabProps = {
    values: autosave.values,
    update: autosave.update,
    setLocal: (patch) => autosave.setValues((v) => ({ ...v, ...patch })),
    errors: autosave.errors,
    functionSpec: meta.functionSpec,
  };

  return (
    <AppShell wide>
      <Link to="/manage/questions" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Question bank
      </Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{autosave.values.title || 'Untitled question'}</h1>
          <StatusPill status={meta.status} />
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={autosave.state} error={autosave.lastError} />
          {meta.status === 'draft' ? (
            <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate(false)}>
              Publish
            </Button>
          ) : (
            <Button variant="secondary" loading={unpublish.isPending} onClick={() => unpublish.mutate()}>
              Move to draft
            </Button>
          )}
          <Button variant="ghost" aria-label="Delete question" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {publishProblems.length > 0 && (
        <div className="mb-4">
          <ErrorNote>
            Finish these before publishing:
            <ul className="mt-1 list-disc pl-5">
              {publishProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </ErrorNote>
        </div>
      )}

      {meta.source && (meta.testCount === 0 || !autosave.values.statement.trim()) && (
        <Notice className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-medium text-ink">Imported draft: review before publishing.</span>
          {!autosave.values.statement.trim() && (
            <span>
              The source does not provide the statement.{' '}
              {meta.source.url && (
                <a href={meta.source.url} target="_blank" rel="noreferrer noopener" className="font-medium text-accent hover:underline">
                  Open the original
                </a>
              )}{' '}
              and use "Paste a whole statement".
            </span>
          )}
          {meta.testCount === 0 && (
            <span>
              It has no tests yet.{' '}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => setParams({ tab: 'tests' }, { replace: true })}>
                Add tests
              </button>
              , then fill their outputs from a reference solution.
            </span>
          )}
        </Notice>
      )}
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabList className="mb-6">
          <Tab value="statement">Statement</Tab>
          <Tab value="tests">
            Tests <span className="text-ink-3 tabular-nums">{meta.testCount}</span>
          </Tab>
          <Tab value="settings">Limits and languages</Tab>
          <Tab value="validate">Validate</Tab>
        </TabList>
        <TabPanel value="statement">
          <StatementTab {...tabProps} source={meta.source} />
        </TabPanel>
        <TabPanel value="tests">
          <TestsTab questionId={id} {...tabProps} />
        </TabPanel>
        <TabPanel value="settings">
          <SettingsTab {...tabProps} />
        </TabPanel>
        <TabPanel value="validate">
          <ValidateTab questionId={id} {...tabProps} flush={autosave.flush} meta={meta} />
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={confirmPublish != null}
        onOpenChange={(o) => !o && setConfirmPublish(null)}
        title="Publish without a passing validation?"
        description={
          <>
            <p>{confirmPublish}</p>
            <p className="mt-2">Validating runs your reference solution against every test, which catches wrong expected outputs before participants see them.</p>
          </>
        }
        confirmLabel="Publish anyway"
        cancelLabel="Validate first"
        loading={publish.isPending}
        onConfirm={() => publish.mutate(true)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this question?"
        description="Its tests, drafts and practice submissions are deleted too. Questions used in a contest cannot be deleted."
        confirmLabel="Delete question"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </AppShell>
  );
}

export default function QuestionEditorPage() {
  const { id } = useParams();
  const question = useQuery({
    queryKey: ['question', Number(id)],
    queryFn: () => api.get<QuestionEditorDTO>(`/api/manage/questions/${id}`),
    staleTime: Infinity,
  });
  if (question.isPending) {
    return (
      <AppShell>
        <Spinner />
      </AppShell>
    );
  }
  if (question.error) {
    return (
      <AppShell>
        <ErrorNote>{errorMessage(question.error)}</ErrorNote>
      </AppShell>
    );
  }
  return <Editor key={question.data.id} question={question.data} />;
}
