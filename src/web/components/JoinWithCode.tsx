import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Button, ErrorNote, Field, Input } from './ui';

/** Join a contest with the code an organizer handed out; signed-out people join as guests. */
export function JoinWithCode({ signedIn, initialCode = '' }: { signedIn: boolean; initialCode?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const join = useMutation({
    mutationFn: () => api.post<{ contestId: number }>('/api/contests/join', { code: code.trim(), displayName: signedIn ? undefined : name.trim() }),
    onSuccess: async ({ contestId }) => {
      await qc.invalidateQueries();
      navigate(`/contests/${contestId}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) join.mutate();
  };

  const fieldErrors = join.error instanceof ApiError ? join.error.fieldErrors : {};

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Join with a code</h2>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        {signedIn ? 'Enter the code your organizer gave you.' : 'No account needed if the organizer allows guests.'}
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Field label="Contest code" error={fieldErrors.code}>
          {(p) => (
            <Input
              {...p}
              mono
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="K7Q2-MX4P"
            />
          )}
        </Field>
        {!signedIn && (
          <Field label="Your name" hint="Shown to the organizer." error={fieldErrors.displayName}>
            {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        )}
        {join.error && Object.keys(fieldErrors).length === 0 && <ErrorNote>{join.error.message}</ErrorNote>}
        <Button type="submit" variant="secondary" loading={join.isPending} disabled={!code.trim()}>
          Join contest
        </Button>
      </form>
    </section>
  );
}
