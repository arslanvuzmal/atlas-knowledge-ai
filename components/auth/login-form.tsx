'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/ui';

const DEMO_ACCOUNTS = [
  { role: 'ADMIN', label: 'Admin', email: 'admin@atlasknowledge.demo' },
  { role: 'MANAGER', label: 'Manager', email: 'manager@atlasknowledge.demo' },
  { role: 'EMPLOYEE', label: 'Employee', email: 'employee@atlasknowledge.demo' },
  { role: 'CUSTOMER', label: 'Customer', email: 'customer@atlasknowledge.demo' },
  { role: 'VIEWER', label: 'Public', email: 'viewer@atlasknowledge.demo' },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function performLogin(loginEmail: string, loginPass: string) {
    setPending(true);
    setError(null);

    const result = await apiFetch<{ ok: true }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: loginEmail, password: loginPass }),
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await performLogin(email, password);
  }

  const handleQuickDemoLogin = async (demoEmail: string) => {
    const demoPass = 'AtlasDemo!2026';
    setEmail(demoEmail);
    setPassword(demoPass);
    await performLogin(demoEmail, demoPass);
  };

  return (
    <div className="space-y-4">
      {/* 1-Click Quick Demo Login Buttons */}
      <div className="rounded-md border border-iris/40 bg-iris-wash/40 p-3 space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-iris-soft block">
          ⚡ 1-Click Quick Demo Sign-in
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.role}
              type="button"
              disabled={pending}
              onClick={() => handleQuickDemoLogin(acc.email)}
              className="px-2 py-1 text-xs font-semibold rounded border border-edge bg-canvas hover:border-accent hover:text-accent transition text-center truncate"
            >
              {acc.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field"
            placeholder="you@example.com"
            aria-describedby={error ? 'login-error' : undefined}
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
            placeholder="Your password"
            aria-describedby={error ? 'login-error' : undefined}
          />
        </div>

        {error ? (
          <p
            id="login-error"
            role="alert"
            className="rounded-md border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-status-critical"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
