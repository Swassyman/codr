import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { contestFieldsSchema, type ContestFields } from '../../../../shared/schemas';
import { LANGUAGE_IDS } from '../../../../shared/languages';
import type { ContestEditorDTO } from '../../../../shared/api';
import { api, ApiError, errorMessage } from '../../../lib/api';
import { useAutosave } from '../../../lib/autosave';
import { cn } from '../../../lib/cn';
import { useLanguageLabel } from '../../../lib/runtimes';
import { AppShell } from '../../../components/AppShell';
import { AutoTextarea, SaveIndicator } from '../../../components/form-bits';
import { Button, ConfirmDialog, ErrorNote, Field, IconButton, Input, Spinner, Switch } from '../../../components/ui';
import { StatusPill } from '../QuestionsPage';
import { QuestionsSection } from './QuestionsSection';
import { ParticipantsSection } from './ParticipantsSection';

const pad = (n: number) => String(n).padStart(2, '0');
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : '');

function Section({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-4 border-b border-line py-8 first:pt-2 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <div className="mt-1 text-sm text-ink-2">{description}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function Choice<T extends string>({ name, value, options, onChange, disabled }: { name: string; value: T; options: { value: T; label: string; description: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm',
            value === o.value ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-raised',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} className="accent-[var(--accent)]" />
            {o.label}
          </span>
          <span className="text-xs text-ink-2">{o.description}</span>
        </label>
      ))}
    </div>
  );
}

const minutesInput = (value: number | null, onChange: (v: number | null) => void, props: { id: string; 'aria-invalid'?: boolean; disabled?: boolean }) => (
  <Input
    {...props}
    type="number"
    min={1}
    className="max-w-36"
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
  />
);

function pick(c: ContestEditorDTO): ContestFields {
  return {
    name: c.name,
    description: c.description,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    visibility: c.visibility,
    allowGuests: c.allowGuests,
    registrationOpen: c.registrationOpen,
    allowedLanguages: c.allowedLanguages,
    timingMode: c.timingMode,
    durationMinutes: c.durationMinutes,
    defaultQuestionMinutes: c.defaultQuestionMinutes,
    viewOnce: c.viewOnce,
    sequential: c.sequential,
    maxSubmissionsPerQuestion: c.maxSubmissionsPerQuestion,
    maxRunsPerMinute: c.maxRunsPerMinute,
    revealHidden: c.revealHidden,
    verdictDetail: c.verdictDetail,
    scoring: c.scoring,
    penaltyMinutes: c.penaltyMinutes,
    leaderboardEnabled: c.leaderboardEnabled,
    leaderboardFreezeMinutes: c.leaderboardFreezeMinutes,
    recordIntegrity: c.recordIntegrity,
    autocomplete: c.autocomplete,
  };
}

function Editor({ initial }: { initial: ContestEditorDTO }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const id = initial.id;
  const meta = useQuery({ queryKey: ['manage-contest', id], queryFn: () => api.get<ContestEditorDTO>(`/api/manage/contests/${id}`), initialData: initial }).data;
  const { values, update, errors, state, lastError, flush } = useAutosave<ContestFields>({
    initial: pick(initial),
    shape: contestFieldsSchema.shape,
    save: async (patch) => qc.setQueryData(['manage-contest', id], await api.patch<ContestEditorDTO>(`/api/manage/contests/${id}`, patch)),
  });
  const [problems, setProblems] = useState<{ path: string; message: string }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = meta.started;
  const languageLabel = useLanguageLabel();

  const publish = useMutation({
    mutationFn: async () => {
      await flush();
      return api.post(`/api/manage/contests/${id}/publish`);
    },
    onSuccess: () => {
      setProblems([]);
      toast.success('Published. Participants can see it now.');
      void qc.invalidateQueries({ queryKey: ['manage-contest', id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'not_ready' && Array.isArray(err.details)) setProblems(err.details as { path: string; message: string }[]);
      else toast.error(errorMessage(err));
    },
  });
  const unpublish = useMutation({
    mutationFn: () => api.post(`/api/manage/contests/${id}/unpublish`),
    onSuccess: () => {
      toast.success('Moved back to draft.');
      void qc.invalidateQueries({ queryKey: ['manage-contest', id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const newCode = useMutation({
    mutationFn: () => api.post<{ joinCode: string }>(`/api/manage/contests/${id}/join-code`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['manage-contest', id] }),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/manage/contests/${id}`),
    onSuccess: () => navigate('/manage/contests'),
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(errorMessage(err));
    },
  });

  const timingLocked = locked ? 'Locked because the contest has started.' : undefined;
  const allProblems = problems.length ? problems : [];

  return (
    <AppShell>
      <Link to="/manage/contests" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Contest builder
      </Link>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{values.name || 'Untitled contest'}</h1>
          <StatusPill status={meta.status} />
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={state} error={lastError} />
          <Link to={`/manage/contests/${id}/results`} className="text-sm font-medium text-accent hover:underline">
            Results
          </Link>
          {meta.status === 'draft' ? (
            <Button variant="primary" onClick={() => publish.mutate()} loading={publish.isPending}>
              Publish
            </Button>
          ) : (
            <Button onClick={() => unpublish.mutate()} loading={unpublish.isPending}>
              Move to draft
            </Button>
          )}
          <IconButton label="Delete contest" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      {meta.status === 'published' && (
        <p className="mb-2 text-sm text-ink-2">
          Participants open it at{' '}
          <Link className="font-medium text-accent hover:underline" to={`/contests/${id}`}>
            /contests/{id}
          </Link>
          .
        </p>
      )}
      {allProblems.length > 0 && (
        <div className="mt-3">
          <ErrorNote>
            Finish these before publishing:
            <ul className="mt-1 list-disc pl-5">
              {allProblems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </ErrorNote>
        </div>
      )}

      <Section title="Basics">
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} value={values.name} onChange={(e) => update({ name: e.target.value })} />}
        </Field>
        <Field label="Description" optional hint="Markdown. Shown on the contest page before people start." error={errors.description}>
          {(p) => <AutoTextarea {...p} minRows={3} value={values.description} onChange={(e) => update({ description: e.target.value })} />}
        </Field>
      </Section>

      <Section
        title="Timing"
        description="The server is the only clock: every deadline is checked when a request arrives. Times are shown in your browser's time zone."
      >
        <Choice
          name="timingMode"
          value={values.timingMode}
          disabled={locked}
          onChange={(timingMode) => update({ timingMode })}
          options={[
            { value: 'fixed_window', label: 'Fixed window', description: 'Everyone starts and stops at the same times.' },
            { value: 'personal_window', label: 'Personal window', description: 'Each person gets N minutes from when they press Start.' },
            { value: 'per_question', label: 'Timer per question', description: 'Each question has its own timer, started when it is first opened.' },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={values.timingMode === 'personal_window' ? 'Opens' : 'Starts'} error={errors.startsAt} hint={timingLocked}>
            {(p) => <Input {...p} type="datetime-local" disabled={locked} value={toLocalInput(values.startsAt)} onChange={(e) => e.target.value && update({ startsAt: fromLocalInput(e.target.value) })} />}
          </Field>
          <Field
            label={values.timingMode === 'personal_window' ? 'Entry closes' : 'Ends'}
            hint={values.timingMode === 'personal_window' ? 'Nobody can start after this. Those who started keep their full time.' : undefined}
            error={errors.endsAt}
          >
            {(p) => <Input {...p} type="datetime-local" value={toLocalInput(values.endsAt)} onChange={(e) => e.target.value && update({ endsAt: fromLocalInput(e.target.value) })} />}
          </Field>
        </div>
        {values.timingMode === 'personal_window' && (
          <Field label="Minutes per participant" error={errors.durationMinutes}>
            {(p) => minutesInput(values.durationMinutes, (durationMinutes) => update({ durationMinutes }), { ...p, disabled: locked })}
          </Field>
        )}
        {values.timingMode === 'per_question' && (
          <Field label="Default minutes per question" hint="Override it per question below. A question's timer is cut short if the contest ends first." error={errors.defaultQuestionMinutes}>
            {(p) => minutesInput(values.defaultQuestionMinutes, (defaultQuestionMinutes) => update({ defaultQuestionMinutes }), { ...p, disabled: locked })}
          </Field>
        )}
      </Section>

      <Section id="questions" title="Questions" description="Lettered A, B, C in this order. Only published questions can be in a published contest.">
        <QuestionsSection contest={meta} perQuestion={values.timingMode === 'per_question'} defaultMinutes={values.defaultQuestionMinutes} />
      </Section>

      <Section title="Navigation">
        <Switch
          label="View once"
          description="A participant who opens a question can never return to it after moving on. Enforced on the server, so a refresh, new tab or other device cannot get around it."
          checked={values.viewOnce}
          disabled={locked}
          onCheckedChange={(viewOnce) => update({ viewOnce })}
        />
        <Switch label="In order only" description="Questions must be opened in order; no skipping ahead." checked={values.sequential} disabled={locked} onCheckedChange={(sequential) => update({ sequential })} />
      </Section>

      <Section title="Editor" description="Autocomplete suggests words already in the participant's code. The rule is shown to participants and locks once the contest starts.">
        <Choice
          name="autocomplete"
          value={values.autocomplete}
          disabled={locked}
          onChange={(autocomplete) => update({ autocomplete })}
          options={[
            { value: 'user_choice', label: 'Participant chooses', description: 'Each participant can turn it on in the editor. Off until they do.' },
            { value: 'off', label: 'Always off', description: 'Nobody gets suggestions, hints or snippets.' },
            { value: 'on', label: 'Always on', description: 'Everyone gets suggestions; it cannot be turned off.' },
          ]}
        />
        {timingLocked && <p className="text-xs text-ink-3">{timingLocked}</p>}
      </Section>

      <Section title="Access">
        <Choice
          name="visibility"
          value={values.visibility}
          onChange={(visibility) => update({ visibility })}
          options={[
            { value: 'public', label: 'Public', description: 'Listed on the home page. Anyone signed in can register.' },
            { value: 'invite', label: 'Invite code', description: 'Hidden. People join with the code below.' },
            { value: 'private', label: 'Private', description: 'Hidden. Only people you add can take part.' },
          ]}
        />
        {values.visibility !== 'private' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-2">Join code</span>
            <code className="rounded-md border border-line bg-well px-3 py-1.5 font-mono text-lg font-semibold tracking-wider">{meta.joinCode}</code>
            <IconButton
              label="Copy join code"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(meta.joinCode);
                  toast.success('Join code copied.');
                } catch {
                  toast.error('Copy is blocked here. Select the code instead.');
                }
              }}
            >
              <Copy className="size-4" />
            </IconButton>
            <IconButton label="Make a new join code" onClick={() => newCode.mutate()}>
              <RefreshCw className={cn('size-4', newCode.isPending && 'animate-spin')} />
            </IconButton>
          </div>
        )}
        <Switch label="Registration open" description="When off, nobody new can register or join." checked={values.registrationOpen} onCheckedChange={(registrationOpen) => update({ registrationOpen })} />
        {values.visibility !== 'private' && (
          <Switch
            label="Allow guests"
            description="People without an account can join with the code and a name. Their identity lives in one browser, so use accounts for strict view-once contests."
            checked={values.allowGuests}
            onCheckedChange={(allowGuests) => update({ allowGuests })}
          />
        )}
        {values.visibility === 'private' && <ParticipantsSection contestId={id} />}
      </Section>

      <Section title="Languages" description="Leave all unchecked to use each question's own languages.">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {LANGUAGE_IDS.map((l) => (
            <label key={l} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={values.allowedLanguages.includes(l)}
                onChange={(e) => update({ allowedLanguages: e.target.checked ? [...values.allowedLanguages, l] : values.allowedLanguages.filter((x) => x !== l) })}
              />
              {languageLabel(l)}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Limits">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Submissions per question" optional hint="Empty means unlimited. Automatic submissions do not count." error={errors.maxSubmissionsPerQuestion}>
            {(p) => minutesInput(values.maxSubmissionsPerQuestion, (maxSubmissionsPerQuestion) => update({ maxSubmissionsPerQuestion }), p)}
          </Field>
          <Field label="Runs per minute" optional hint="Empty means the server default." error={errors.maxRunsPerMinute}>
            {(p) => minutesInput(values.maxRunsPerMinute, (maxRunsPerMinute) => update({ maxRunsPerMinute }), p)}
          </Field>
        </div>
      </Section>

      <Section title="Results and scoring">
        <Choice
          name="scoring"
          value={values.scoring}
          onChange={(scoring) => update({ scoring })}
          options={[
            { value: 'partial', label: 'Partial credit', description: 'Points for each passed test (or group).' },
            { value: 'all_or_nothing', label: 'All or nothing', description: 'Points only when every test passes.' },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hidden test results" error={errors.revealHidden}>
            {(p) => (
              <select {...p} className="h-9 rounded-md border border-line-strong bg-surface px-2.5 text-sm" value={values.revealHidden} onChange={(e) => update({ revealHidden: e.target.value as ContestFields['revealHidden'] })}>
                <option value="during">Shown right away</option>
                <option value="after">Shown after the contest</option>
              </select>
            )}
          </Field>
          <Field label="Verdict detail" error={errors.verdictDetail}>
            {(p) => (
              <select {...p} className="h-9 rounded-md border border-line-strong bg-surface px-2.5 text-sm" value={values.verdictDetail} onChange={(e) => update({ verdictDetail: e.target.value as ContestFields['verdictDetail'] })}>
                <option value="per_test">Each test's result</option>
                <option value="summary">Only how many passed</option>
              </select>
            )}
          </Field>
        </div>
        <Field label="Penalty minutes per rejected attempt" optional hint="Used to break ties together with time taken. Empty means no penalty." error={errors.penaltyMinutes}>
          {(p) => minutesInput(values.penaltyMinutes, (penaltyMinutes) => update({ penaltyMinutes }), p)}
        </Field>
        <Switch
          label="Leaderboard"
          description="Off by default. The data is always kept; turning this on exposes standings to participants (the page itself is behind FEATURE_LEADERBOARD_UI)."
          checked={values.leaderboardEnabled}
          onCheckedChange={(leaderboardEnabled) => update({ leaderboardEnabled })}
        />
        {values.leaderboardEnabled && (
          <Field label="Freeze the leaderboard this many minutes before the end" optional error={errors.leaderboardFreezeMinutes}>
            {(p) => minutesInput(values.leaderboardFreezeMinutes, (leaderboardFreezeMinutes) => update({ leaderboardFreezeMinutes }), p)}
          </Field>
        )}
      </Section>

      <Section title="Integrity signals" description="Recorded only to inform you. They do not prevent cheating, and participants are told they are on.">
        <Switch label="Record tab switches and pastes" checked={values.recordIntegrity} onCheckedChange={(recordIntegrity) => update({ recordIntegrity })} />
      </Section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this contest?"
        description="Contests that people have joined cannot be deleted; unpublish them instead."
        confirmLabel="Delete contest"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </AppShell>
  );
}

export default function ContestEditorPage() {
  const { id } = useParams();
  const contest = useQuery({ queryKey: ['manage-contest', Number(id)], queryFn: () => api.get<ContestEditorDTO>(`/api/manage/contests/${id}`), staleTime: Infinity });
  if (contest.isPending)
    return (
      <AppShell>
        <Spinner />
      </AppShell>
    );
  if (contest.error)
    return (
      <AppShell>
        <ErrorNote>{errorMessage(contest.error)}</ErrorNote>
      </AppShell>
    );
  return <Editor key={contest.data.id} initial={contest.data} />;
}
