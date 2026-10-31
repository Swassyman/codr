import { useId, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { Settings2 } from 'lucide-react';
import { KEY_BINDINGS, TAB_WIDTHS, type EditorSettings, type KeyBindings } from '../../lib/editor-settings';
import { EDITOR_THEMES, type EditorThemeId } from '../../lib/editor-themes';
import { isMac } from '../../lib/media';
import { SHORTCUT_LABELS, type WorkspaceShortcut } from '../../lib/shortcuts';
import { cn } from '../../lib/cn';
import { IconButton, Kbd, Select, Switch } from '../ui';

const bindingLabel: Record<KeyBindings, string> = { default: 'Default', vim: 'Vim', emacs: 'Emacs' };

const shortcutRows: { id: WorkspaceShortcut; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'submit', label: 'Submit' },
  { id: 'zen', label: 'Zen mode' },
  { id: 'peek', label: 'Problem (in zen)' },
  { id: 'fullscreen', label: 'Fullscreen' },
];

/** A row of native radio buttons styled as a segmented control. */
function Segmented<T extends string | number>({ label, value, options, onChange, format }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; format: (v: T) => string }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      <div className="flex rounded-md border border-line-strong p-0.5">
        {options.map((option) => (
          <label
            key={option}
            className={cn(
              'flex h-7 flex-1 cursor-pointer items-center justify-center rounded-[5px] text-sm text-ink-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent hover:text-ink',
              value === option && 'bg-accent-soft font-medium text-ink',
            )}
          >
            <input type="radio" className="sr-only" name={name} value={String(option)} checked={value === option} onChange={() => onChange(option)} />
            {format(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

/**
 * Editor settings from the workspace toolbar. Presentation and input only:
 * autocomplete and paste handling follow the contest, never these.
 */
export function EditorSettingsButton({ settings, onChange, language }: { settings: EditorSettings; onChange: (patch: Partial<EditorSettings>) => void; language: string }) {
  const themeId = useId();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label="Editor settings">
          <Settings2 className="size-4" />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface p-4 text-sm shadow-pop"
          aria-label="Editor settings"
        >
          <h2 className="text-base font-semibold">Editor settings</h2>
          <Segmented label="Key bindings" value={settings.keyBindings} options={KEY_BINDINGS} onChange={(keyBindings) => onChange({ keyBindings })} format={(v) => bindingLabel[v]} />
          <div>
            <Segmented label="Tab width" value={settings.tabWidth} options={TAB_WIDTHS} onChange={(tabWidth) => onChange({ tabWidth })} format={(v) => `${v} spaces`} />
            {language === 'go' && <p className="mt-1.5 text-xs text-ink-3">Go indents with tabs, shown at this width.</p>}
          </div>
          <Row>
            <label htmlFor={themeId} className="text-sm font-medium text-ink">
              Editor theme
            </label>
            <Select id={themeId} value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as EditorThemeId })}>
              {EDITOR_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Row>
          <Switch
            label="Always show contest timer"
            description="Otherwise it stays hidden until you hover or click it, and always shows in the last minute."
            checked={settings.alwaysShowTimer}
            onCheckedChange={(alwaysShowTimer) => onChange({ alwaysShowTimer })}
          />
          <div className="border-t border-line pt-3">
            <h3 className="mb-2 text-xs font-medium text-ink-3">Shortcuts</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs text-ink-2">
              {shortcutRows.map((row) => (
                <div key={row.id} className="contents">
                  <dt>{row.label}</dt>
                  <dd>
                    <Kbd>{SHORTCUT_LABELS[row.id][isMac ? 'mac' : 'other']}</Kbd>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-ink-3">These work with Vim and Emacs bindings too. Saved for your account on this device.</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
