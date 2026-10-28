import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { ContestResultsDTO } from '../../../../shared/api';
import { api, ApiError, errorMessage } from '../../../lib/api';
import { Button, Field, IconButton, Input } from '../../../components/ui';

/** Private contests: the creator adds people by username. */
export function ParticipantsSection({ contestId }: { contestId: number }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const results = useQuery({ queryKey: ['contest-results', contestId], queryFn: () => api.get<ContestResultsDTO>(`/api/manage/contests/${contestId}/results`) });
  const add = useMutation({
    mutationFn: () => api.post(`/api/manage/contests/${contestId}/participants`, { username: username.trim() }),
    onSuccess: () => {
      setUsername('');
      void qc.invalidateQueries({ queryKey: ['contest-results', contestId] });
    },
  });
  const remove = useMutation({
    mutationFn: (pid: number) => api.del(`/api/manage/contests/${contestId}/participants/${pid}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contest-results', contestId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim()) add.mutate();
  };
  const people = results.data?.participants ?? [];
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex items-end gap-2">
        <Field label="Add a participant" className="flex-1" error={add.error instanceof ApiError ? (add.error.fieldErrors.username ?? add.error.message) : null}>
          {(p) => <Input {...p} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Button type="submit" loading={add.isPending} disabled={!username.trim()}>
          Add
        </Button>
      </form>
      {people.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line">
          {people.map((p) => (
            <li key={p.participantId} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {p.displayName} <span className="text-ink-3">{p.username}</span>
              </span>
              {!p.enteredAt && (
                <IconButton label={`Remove ${p.displayName}`} onClick={() => remove.mutate(p.participantId)}>
                  <X className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Nobody added yet.</p>
      )}
    </div>
  );
}
