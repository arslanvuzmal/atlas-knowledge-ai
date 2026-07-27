'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { apiFetch, cn } from '@/lib/ui';
import type { NavGroup } from './nav';

/**
 * Dashboard shell.
 *
 * The sidebar collapses to an overlay below the large breakpoint. Navigation
 * is a real <nav> with aria-current on the active route, and the mobile toggle
 * manages focus and Escape so it is usable from the keyboard alone.
 */
export function DashboardShell({
  groups,
  user,
  demoMode,
  children,
}: {
  groups: NavGroup[];
  user: { name: string; email: string; roleLabel: string };
  demoMode: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const nav = (
    <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} className="mb-5">
          <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    title={item.description}
                    className={cn(
                      'block rounded-md px-2.5 py-1.5 text-sm transition',
                      active
                        ? 'bg-accent-wash font-medium text-accent-soft'
                        : 'text-ink-muted hover:bg-canvas-overlay hover:text-ink',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-edge bg-canvas-sunken lg:flex">
        <div className="border-b border-edge px-4 py-4">
          <Link href="/" className="rounded-md">
            <Wordmark size={24} />
          </Link>
        </div>
        {nav}
        <SidebarFooter
          user={user}
          demoMode={demoMode}
          onSignOut={signOut}
          signingOut={signingOut}
        />
      </aside>

      {/* Mobile overlay */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-canvas-sunken/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-72 flex-col border-r border-edge bg-canvas-sunken">
            <div className="flex items-center justify-between border-b border-edge px-4 py-4">
              <Wordmark size={24} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-ink-muted hover:text-ink"
                aria-label="Close navigation"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            {nav}
            <SidebarFooter
              user={user}
              demoMode={demoMode}
              onSignOut={signOut}
              signingOut={signingOut}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-edge bg-canvas/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-md border border-edge p-2 text-ink-muted transition hover:text-ink lg:hidden"
                aria-label="Open navigation"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M3 5h14M3 10h14M3 15h14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <span className="lg:hidden">
                <Wordmark size={22} />
              </span>
            </div>

            <div className="flex items-center gap-2">
              {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
              <Link
                href="/chat"
                className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
              >
                Open chat
              </Link>
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarFooter({
  user,
  demoMode,
  onSignOut,
  signingOut,
}: {
  user: { name: string; email: string; roleLabel: string };
  demoMode: boolean;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className="border-t border-edge px-4 py-3">
      {demoMode ? <DemoBadge className="mb-3" /> : null}
      <p className="truncate text-sm font-medium text-ink">{user.name}</p>
      <p className="truncate text-xs text-ink-faint">{user.email}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-accent">{user.roleLabel}</p>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="mt-3 w-full rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink disabled:opacity-60"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
