import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertDialog, Checkbox as RCheckbox, Dialog as RDialog, Switch as RSwitch, Tabs as RTabs } from 'radix-ui';
import { Check, LoaderCircle, X } from 'lucide-react';
import { cn } from '../lib/cn';

// ---------------------------------------------------------------- Buttons

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-raised',
  ghost: 'text-ink-2 hover:text-ink hover:bg-raised border border-transparent',
  danger: 'bg-surface text-bad border border-line-strong hover:bg-bad-soft hover:border-bad',
  quiet: 'text-accent hover:underline underline-offset-2 border border-transparent px-0',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        variant === 'quiet' && 'h-auto px-0',
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------- Form controls

const controlBase =
  'w-full rounded-md border border-line-strong bg-surface text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 disabled:opacity-60 aria-[invalid=true]:border-bad';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className, mono, ...rest }, ref) {
    return <input ref={ref} className={cn(controlBase, 'h-9 px-3 text-sm', mono && 'font-mono', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  function Textarea({ className, mono, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        spellCheck={mono ? false : undefined}
        className={cn(controlBase, 'min-h-20 px-3 py-2 text-sm leading-relaxed', mono && 'font-mono text-[13px]', className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(controlBase, 'h-9 cursor-pointer px-2.5 text-sm', className)} {...rest}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
  optional?: boolean;
}

/** Label + control + hint + inline error, wired up for screen readers. */
export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-3">optional</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <RCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RCheckbox.Indicator>
          <Check className="size-3 text-on-accent" strokeWidth={3} />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id} className="cursor-pointer text-sm leading-5 text-ink">
        {label}
        {description && <span className="block text-xs text-ink-3">{description}</span>}
      </label>
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  id: givenId,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const control = (
    <RSwitch.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={typeof label === 'string' ? label : undefined}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-raised transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-ink-3 shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-on-accent" />
    </RSwitch.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="cursor-pointer text-sm text-ink">
        {label}
        {description && <span className="mt-0.5 block text-xs text-ink-3">{description}</span>}
      </label>
      {control}
    </div>
  );
}

// ---------------------------------------------------------------- Dialogs

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[88dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[10px] border border-line bg-surface p-5 shadow-pop',
            wide ? 'max-w-4xl' : 'max-w-md',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="text-lg font-semibold">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-ink-2">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close" className="-mt-1 -mr-1">
                <X className="size-4" />
              </IconButton>
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** A yes/no confirmation that the person has to answer explicitly. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  tone = 'primary',
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  tone?: 'primary' | 'danger';
  loading?: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-line bg-surface p-5 shadow-pop">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm text-ink-2">{description}</div>
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// ---------------------------------------------------------------- Tabs

export const Tabs = RTabs.Root;

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return <RTabs.List className={cn('flex items-end gap-1 border-b border-line', className)}>{children}</RTabs.List>;
}

export function Tab({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RTabs.Trigger
      value={value}
      className={cn(
        '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm text-ink-2 transition-colors hover:text-ink',
        'data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-ink',
        className,
      )}
    >
      {children}
    </RTabs.Trigger>
  );
}

export const TabPanel = RTabs.Content;

// ---------------------------------------------------------------- Misc

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <LoaderCircle className={cn('size-4 animate-spin text-ink-3', className)} aria-label={label} role="status" />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('rounded border border-line-strong bg-raised px-1 py-px font-mono text-[11px] leading-none text-ink-2', className)}>{children}</kbd>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-10">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-prose text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 max-w-prose text-sm text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-bad/40 bg-bad-soft px-3 py-2 text-sm text-bad">
      {children}
    </div>
  );
}

export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink-2', className)}>{children}</div>;
}
