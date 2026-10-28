import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { createUserSchema } from '../../../shared/schemas';
import type { Role } from '../../../shared/types';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { AppShell } from '../../components/AppShell';
import { Button, Checkbox, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';

interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  isGuest: boolean;
  disabled: boolean;
  createdAt: string;
}

const roleLabel: Record<Role, string> = { admin: 'Administrator', creator: 'Contest creator', participant: 'Participant' };

function AddUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '', role: 'participant' as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.post('/api/admin/users', form),
    onSuccess: () => {
      toast.success(`Created ${form.username}.`);
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = createUserSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    create.mutate();
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a user" description="Share the username and password with the person; they can sign in right away.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Username" error={errors.username}>
          {(p) => <Input {...p} autoComplete="off" value={form.username} onChange={set('username')} />}
        </Field>
        <Field label="Display name" error={errors.displayName}>
          {(p) => <Input {...p} value={form.displayName} onChange={set('displayName')} />}
        </Field>
        <Field label="Email" optional error={errors.email}>
          {(p) => <Input {...p} type="email" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password}>
          {(p) => <Input {...p} type="text" autoComplete="off" value={form.password} onChange={set('password')} />}
        </Field>
        <Field label="Role" error={errors.role}>
          {(p) => (
            <Select {...p} value={form.role} onChange={set('role')}>
              <option value="participant">Participant</option>
              <option value="creator">Contest creator</option>
              <option value="admin">Administrator</option>
            </Select>
          )}
        </Field>
        {create.error && !(create.error instanceof ApiError && Object.keys(create.error.fieldErrors).length) && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Add user
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.patch(`/api/admin/users/${user.id}`, { password }),
    onSuccess: () => {
      toast.success(`New password set for ${user.username}. They were signed out everywhere.`);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Reset the password for ${user.username}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <Field label="New password" hint="At least 8 characters." error={reset.error instanceof ApiError ? (reset.error.fieldErrors.password ?? reset.error.message) : null}>
          {(p) => <Input {...p} type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={reset.isPending} disabled={password.length < 8}>
            Set password
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const me = useUser();
  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const list = useQuery({
    queryKey: ['admin-users', search, guests],
    queryFn: () => api.get<{ users: AdminUser[] }>(`/api/admin/users?search=${encodeURIComponent(search)}&guests=${guests ? 1 : 0}`),
    placeholderData: (prev) => prev,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Pick<AdminUser, 'role' | 'disabled'>> }) => api.patch(`/api/admin/users/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <AppShell>
      <PageHeader
        title="Users"
        description="Contest creators can write questions and run contests. Participants can join contests and practice."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add user
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Search users" placeholder="Search by name, username or email" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Checkbox checked={guests} onCheckedChange={setGuests} label="Show contest guests" />
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote>{errorMessage(list.error)}</ErrorNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="py-2 pr-4 font-medium">Person</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Joined</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {list.data!.users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-b border-line">
                    <td className="py-2.5 pr-4">
                      <span className="font-medium">{u.displayName}</span>
                      <span className="ml-2 text-ink-3">{u.username}</span>
                      {u.email && <span className="block text-xs text-ink-3">{u.email}</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {u.isGuest ? (
                        <span className="text-ink-3">Guest</span>
                      ) : (
                        <Select
                          aria-label={`Role of ${u.username}`}
                          className="h-8 w-44"
                          value={u.role}
                          disabled={self}
                          onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as Role } })}
                        >
                          {(Object.keys(roleLabel) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel[r]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-2">{formatDate(u.createdAt)}</td>
                    <td className="py-2.5 pr-4">{u.disabled ? <span className="text-bad">Disabled</span> : <span className="text-ink-2">Active</span>}</td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {!u.isGuest && (
                        <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                          Reset password
                        </Button>
                      )}
                      {!self && (
                        <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, patch: { disabled: !u.disabled } })}>
                          {u.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddUserDialog onClose={() => setAdding(false)} />}
      {resetting && <PasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </AppShell>
  );
}
