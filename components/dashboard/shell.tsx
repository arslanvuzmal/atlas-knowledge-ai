'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { apiFetch, cn } from '@/lib/ui';
import type { NavGroup } from './nav';

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
    <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 py-3 font-mono text-xs">
      {groups.map((group) => (
        <div key={group.label} className="mb-4">
          <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
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
                      'block rounded px-2.5 py-1.5 transition text-[12px]',
                      active
                        ? 'bg-accent-wash border-l-2 border-accent font-bold text-accent-soft'
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
    <div className="flex min-h-screen bg-canvas text-ink font-sans">
      {/* Desktop Sidebar (232px) */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-edge bg-canvas-sunken lg:flex">
        <div className="border-b border-edge px-4 py-3.5">
          <Link href="/" className="rounded">
            <Wordmark showSubtitle size={24} />
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

      {/* Mobile Sidebar Drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-canvas-sunken/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-[260px] flex-col border-r border-edge bg-canvas-sunken">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3.5">
              <Wordmark size={24} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-muted hover:text-ink"
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
        {/* Top Utility Bar (56px) */}
        <header className="sticky top-0 z-30 flex h-[56px] items-center border-b border-edge bg-canvas/90 backdrop-blur-sm px-4 sm:px-6">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded border border-edge p-1.5 text-ink-muted transition hover:text-ink lg:hidden"
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
                <Wordmark size={20} />
              </span>

              {/* Command Palette Keyboard Shortcut Button */}
              <button
                type="button"
                onClick={() => {
                  const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
                  window.dispatchEvent(event);
                }}
                className="hidden sm:inline-flex items-center gap-2 rounded border border-edge bg-canvas-sunken px-2.5 py-1 font-mono text-xs text-ink-faint hover:border-accent hover:text-ink transition"
              >
                <span>Search knowledge…</span>
                <kbd className="rounded border border-edge-strong bg-canvas-raised px-1 py-0.5 text-[10px] text-ink-muted">
                  ⌘K
                </kbd>
              </button>
            </div>

            <div className="flex items-center gap-3">
              {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
              <Link
                href="/chat"
                className="rounded bg-accent px-3.5 py-1.5 font-mono text-xs font-bold text-ink-inverse transition hover:bg-accent-soft shadow-sm"
              >
                Ask Atlas →
              </Link>
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
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
    <div className="border-t border-edge p-3 font-mono text-xs">
      {demoMode ? <DemoBadge className="mb-2" /> : null}
      <div className="flex items-center justify-between gap-1">
        <p className="truncate font-sans text-xs font-semibold text-ink">{user.name}</p>
        <span className="shrink-0 rounded border border-accent/40 bg-accent-wash px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-accent-soft">
          {user.roleLabel}
        </span>
      </div>
      <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="mt-2.5 w-full rounded border border-edge bg-canvas-raised py-1 text-center text-[11px] text-ink-muted transition hover:border-edge-strong hover:text-ink disabled:opacity-60"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
