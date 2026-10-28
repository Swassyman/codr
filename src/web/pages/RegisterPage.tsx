import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { registerSchema } from '../../shared/schemas';
import { ApiError } from '../lib/api';
import { useMe, useRegister } from '../lib/auth';
import { ThemeToggle, Wordmark } from '../components/AppShell';
import { Button, ErrorNote, Field, Input, Notice } from '../components/ui';

export default function RegisterPage() {
  const me = useMe();
  const register = useRegister();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    register.mutate(parsed.data, {
      onSuccess: () => navigate('/', { replace: true }),
      onError: (err) => {
        if (err instanceof ApiError) setErrors(err.fieldErrors);
      },
    });
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const fieldErrorShown = Object.keys(errors).length > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-12 items-center justify-between px-4">
        <Wordmark />
        <ThemeToggle />
      </div>
      <main className="mx-auto w-full max-w-sm flex-1 px-4 pt-[8vh] pb-12">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 mb-6 text-sm text-ink-2">
          Already have one?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
        {me.data && !me.data.features.registration ? (
          <Notice>Registration is turned off on this server. Ask an organizer for an account or a contest join code.</Notice>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Field label="Username" hint="Letters, digits, dots, dashes and underscores." error={errors.username}>
              {(p) => <Input {...p} autoComplete="username" value={form.username} onChange={set('username')} />}
            </Field>
            <Field label="Display name" hint="Shown to organizers." error={errors.displayName}>
              {(p) => <Input {...p} autoComplete="name" value={form.displayName} onChange={set('displayName')} />}
            </Field>
            <Field label="Email" optional error={errors.email}>
              {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
            </Field>
            <Field label="Password" hint="At least 8 characters." error={errors.password}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
            </Field>
            {register.error && !fieldErrorShown && <ErrorNote>{register.error.message}</ErrorNote>}
            <Button type="submit" variant="primary" loading={register.isPending}>
              Create account
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
