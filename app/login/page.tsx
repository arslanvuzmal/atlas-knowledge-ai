import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { getSession } from '@/lib/auth/session';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await getSession();
  if (session.isAuthenticated) redirect('/dashboard');

  const demoMode = env().DEMO_MODE;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="rounded-md">
            <Wordmark />
          </Link>
          {demoMode ? <DemoBadge /> : null}
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Your role decides which knowledge sources the assistant can reach.
          </p>

          <div className="panel mt-6 p-6">
            <LoginForm />
          </div>

          {demoMode ? (
            <div className="mt-6 rounded-panel border border-iris/30 bg-iris-wash p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-iris-soft">
                Demo accounts
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                Password for all accounts:{' '}
                <code className="font-mono text-accent-soft">AtlasDemo!2026</code>
              </p>
              <ul className="mt-3 space-y-1 font-mono text-[13px] text-ink-muted">
                <li>admin@atlasknowledge.demo</li>
                <li>manager@atlasknowledge.demo</li>
                <li>employee@atlasknowledge.demo</li>
                <li>customer@atlasknowledge.demo</li>
                <li>viewer@atlasknowledge.demo</li>
              </ul>
            </div>
          ) : null}

          <p className="mt-6 text-center text-sm text-ink-muted">
            No account?{' '}
            <Link href="/demo" className="text-accent hover:text-accent-soft">
              Try the public demo
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
