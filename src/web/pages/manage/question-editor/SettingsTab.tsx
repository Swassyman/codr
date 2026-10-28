import { useState, type ReactNode } from 'react';
import { CHECKER_LABELS } from '../../../../shared/checkers';
import { LANGUAGES, LANGUAGE_IDS, effectiveLimits, type LanguageId } from '../../../../shared/languages';
import { CHECKER_TYPES, type CheckerType } from '../../../../shared/types';
import { useRuntimes } from '../../../lib/runtimes';
import { CodeEditor } from '../../../components/CodeEditor';
import { Button, Field, Input, Select, Switch } from '../../../components/ui';
import { formatMs } from '../../../components/verdict';
import type { TabProps } from './QuestionEditorPage';

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-8 first:pt-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const numberOrNull = (v: string) => (v === '' ? null : Number(v));

export function SettingsTab({ values, update, errors }: TabProps) {
  const runtimes = useRuntimes();
  const [starterLang, setStarterLang] = useState<LanguageId>(values.allowedLanguages[0] ?? 'cpp');

  const toggleLanguage = (id: LanguageId, on: boolean) => {
    const next = on ? [...values.allowedLanguages, id] : values.allowedLanguages.filter((l) => l !== id);
    update({ allowedLanguages: LANGUAGE_IDS.filter((l) => next.includes(l)) });
  };

  const setMultiplier = (id: LanguageId, key: 'time' | 'memory', raw: string) => {
    const current = { ...(values.languageLimits[id] ?? {}) };
    const n = numberOrNull(raw);
    if (n == null) delete current[key];
    else current[key] = n;
    const next = { ...values.languageLimits, [id]: current };
    if (Object.keys(current).length === 0) delete next[id];
    update({ languageLimits: next });
  };

  const starter = values.starterCode[starterLang];

  return (
    <div className="max-w-5xl">
      <Section title="Limits" description="Per test. Language multipliers below scale these for slower languages.">
        <div className="grid max-w-md gap-4 sm:grid-cols-2">
          <Field label="Time limit (ms)" error={errors.timeLimitMs}>
            {(p) => <Input {...p} type="number" min={100} step={100} value={values.timeLimitMs} onChange={(e) => update({ timeLimitMs: Number(e.target.value) })} />}
          </Field>
          <Field label="Memory limit (MB)" error={errors.memoryLimitMb}>
            {(p) => <Input {...p} type="number" min={16} step={16} value={values.memoryLimitMb} onChange={(e) => update({ memoryLimitMb: Number(e.target.value) })} />}
          </Field>
        </div>
      </Section>

      <Section title="Languages" description="Participants can submit in the checked languages. Leave a multiplier empty to use the default.">
        {errors.allowedLanguages && <p className="mb-2 text-sm text-bad">{errors.allowedLanguages}</p>}
        {errors.languageLimits && <p className="mb-2 text-sm text-bad">{errors.languageLimits}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-3 font-medium">Allowed</th>
                <th className="py-2 pr-3 font-medium">Language</th>
                <th className="py-2 pr-3 font-medium">Time ×</th>
                <th className="py-2 pr-3 font-medium">Memory ×</th>
                <th className="py-2 pr-3 text-right font-medium">Effective time</th>
                <th className="py-2 text-right font-medium">Effective memory</th>
              </tr>
            </thead>
            <tbody>
              {LANGUAGE_IDS.map((id) => {
                const info = LANGUAGES[id];
                const allowed = values.allowedLanguages.includes(id);
                const eff = effectiveLimits(values, id, values.languageLimits);
                const installed = runtimes.installed.has(id);
                return (
                  <tr key={id} className="border-b border-line">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`Allow ${info.label}`}
                        className="size-4 accent-[var(--accent)]"
                        checked={allowed}
                        onChange={(e) => toggleLanguage(id, e.target.checked)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {info.label}
                      {!installed && runtimes.data && <span className="ml-2 text-xs text-warn">not installed on the runner</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`${info.label} time multiplier`}
                        type="number"
                        step="0.25"
                        min={0.25}
                        className="h-8 w-20 px-2"
                        placeholder={String(info.timeMultiplier)}
                        value={values.languageLimits[id]?.time ?? ''}
                        onChange={(e) => setMultiplier(id, 'time', e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`${info.label} memory multiplier`}
                        type="number"
                        step="0.25"
                        min={0.25}
                        className="h-8 w-20 px-2"
                        placeholder={String(info.memoryMultiplier)}
                        value={values.languageLimits[id]?.memory ?? ''}
                        onChange={(e) => setMultiplier(id, 'memory', e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                      {formatMs(eff.timeLimitMs)}
                      {info.timeOverheadMs > 0 && <span className="block text-xs text-ink-3">incl. {formatMs(info.timeOverheadMs)} start-up</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-2">{eff.memoryLimitMb} MB</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Starter code" description="Prefilled in the editor. Without it, participants get a minimal template.">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select aria-label="Starter code language" className="w-52" value={starterLang} onChange={(e) => setStarterLang(e.target.value as LanguageId)}>
            {values.allowedLanguages.map((l) => (
              <option key={l} value={l}>
                {LANGUAGES[l].label}
                {values.starterCode[l] ? ' (custom)' : ''}
              </option>
            ))}
          </Select>
          {starter == null ? (
            <Button size="sm" onClick={() => update({ starterCode: { ...values.starterCode, [starterLang]: LANGUAGES[starterLang].template } })}>
              Write custom starter code
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = { ...values.starterCode };
                delete next[starterLang];
                update({ starterCode: next });
              }}
            >
              Use the default template
            </Button>
          )}
        </div>
        <CodeEditor
          className="h-56 overflow-hidden rounded-md border border-line"
          language={LANGUAGES[starterLang].monaco}
          value={starter ?? LANGUAGES[starterLang].template}
          readOnly={starter == null}
          onChange={(code) => update({ starterCode: { ...values.starterCode, [starterLang]: code } })}
          ariaLabel="Starter code"
        />
      </Section>

      <Section title="Checking" description="How a program's output is compared with the expected output.">
        <div className="grid max-w-md gap-4 sm:grid-cols-2">
          <Field label="Checker" error={errors.checker}>
            {(p) => (
              <Select
                {...p}
                value={values.checker.type}
                onChange={(e) => {
                  const type = e.target.value as CheckerType;
                  update({ checker: type === 'float' ? { type, epsilon: values.checker.epsilon ?? 1e-6 } : { type } });
                }}
              >
                {CHECKER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHECKER_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {values.checker.type === 'float' && (
            <Field label="Tolerance" hint="Absolute or relative error allowed." error={errors.checker}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  step="any"
                  value={values.checker.epsilon ?? ''}
                  onChange={(e) => update({ checker: { type: 'float', epsilon: e.target.value === '' ? undefined : Number(e.target.value) } })}
                />
              )}
            </Field>
          )}
        </div>
      </Section>

      <Section title="Scoring" description="Default points; a contest can override them. Partial credit is set on the Tests tab.">
        <Field label="Points" className="max-w-40" error={errors.points}>
          {(p) => <Input {...p} type="number" min={0} value={values.points} onChange={(e) => update({ points: Number(e.target.value) })} />}
        </Field>
      </Section>

      <Section title="Practice" description="Published practice questions appear in the practice bank, except while they are in a contest that has not finished.">
        <Switch label="Show in the practice bank" checked={values.practice} onCheckedChange={(practice) => update({ practice })} />
      </Section>
    </div>
  );
}
