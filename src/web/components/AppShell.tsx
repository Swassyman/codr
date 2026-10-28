import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { DropdownMenu } from 'radix-ui';
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useThemePreference, type ThemePreference } from '../lib/theme';
import { isStaffUser, useLogout, useUser } from '../lib/auth';
import { cn } from '../lib/cn';
import { IconButton } from './ui';

export function Wordmark() {
  return (
    <Link to="/" className="font-mono text-[17px] font-bold tracking-tight text-ink" aria-label="Codr home">
      codr
    </Link>
  );
}

const nextTheme: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const themeLabel: Record<ThemePreference, string> = {
  system: 'Theme: follows your system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function ThemeToggle() {
  const [pref, setPref] = useThemePreference();
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;
  return (
    <IconButton label={`${themeLabel[pref]}. Switch theme.`} onClick={() => setPref(nextTheme[pref])}>
      <Icon className="size-4" />
    </IconButton>
  );
}

function NavItem({ to, children, end }: { to: string; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'rounded-md px-2.5 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink',
          isActive && 'bg-raised font-medium text-ink',
        )
      }
    >
      {children}
    </NavLink>
  );
}

const roleLabel = { admin: 'Administrator', creator: 'Contest creator', participant: 'Participant' } as const;

function UserMenu() {
  const user = useUser();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) {
    return (
      <Link to="/login" className="rounded-md px-2.5 py-1.5 text-sm font-medium text-accent hover:underline">
        Sign in
      </Link>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-raised">
        <span className="max-w-40 truncate">{user.displayName}</span>
        <ChevronDown className="size-3.5 text-ink-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 rounded-lg border border-line bg-surface p-1 text-sm shadow-pop"
        >
          <div className="px-2.5 py-2 text-xs text-ink-3">
            Signed in as <span className="font-medium text-ink-2">{user.username}</span>
            <span className="block">{user.isGuest ? 'Guest for one contest' : roleLabel[user.role]}</span>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className="cursor-pointer rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-raised"
            onSelect={() =>
              logout.mutate(undefined, {
                onSuccess: () => navigate('/'),
              })
            }
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function TopBar() {
  const user = useUser();
  const staff = isStaffUser(user);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1240px] items-center gap-4 px-4">
        <Wordmark />
        <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <NavItem to="/" end>
            Contests
          </NavItem>
          {user && !user.isGuest && <NavItem to="/practice">Practice</NavItem>}
          {staff && (
            <>
              <span aria-hidden className="mx-2 h-4 w-px bg-line" />
              <NavItem to="/manage/questions">Question bank</NavItem>
              <NavItem to="/manage/contests">Contest builder</NavItem>
              <NavItem to="/manage/import">Import</NavItem>
            </>
          )}
          {user?.role === 'admin' && (
            <>
              <NavItem to="/admin/users">Users</NavItem>
              <NavItem to="/admin/runner">Runner</NavItem>
            </>
          )}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className={cn('mx-auto px-4 py-8', wide ? 'max-w-[1600px]' : 'max-w-[1240px]')}>{children}</main>
    </div>
  );
}
