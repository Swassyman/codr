import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { loginSchema } from '../../shared/schemas';
import { ApiError, errorMessage } from '../lib/api';
import { useLogin, useMe } from '../lib/auth';
import { Button, ErrorNote, Field, Input } from './ui';

export function SignInForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const login = useLogin();
  const me = useMe();
  const [form, setForm] = useState({ login: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    login.mutate(parsed.data, { onSuccess: () => onSignedIn?.() });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Username or email" error={errors.login}>
        {(p) => (
          <Input
            {...p}
            autoComplete="username"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
          />
        )}
      </Field>
      <Field label="Password" error={errors.password}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        )}
      </Field>
      {login.error && <ErrorNote>{login.error instanceof ApiError ? login.error.message : errorMessage(login.error)}</ErrorNote>}
      <Button type="submit" variant="primary" loading={login.isPending}>
        Sign in
      </Button>
      {me.data?.features.registration && (
        <p className="text-sm text-ink-2">
          No account yet?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </p>
      )}
    </form>
  );
}
