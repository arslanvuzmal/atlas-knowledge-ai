import Link from 'next/link';
import { Panel } from '@/components/ui/primitives';

/**
 * Shown when a signed-in user opens a page their role does not permit.
 *
 * States plainly that this is a permission boundary rather than a broken page,
 * and never names the data behind it.
 */
export function AccessDenied({ area }: { area: string }) {
  return (
    <Panel className="p-8">
      <h1 className="text-lg font-semibold text-ink">You do not have access to {area}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
        Your role does not include permission for this area. This is an access-control decision, not
        an error. If you need it, ask an administrator to review your role.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-block rounded-md border border-edge-strong px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
      >
        Back to overview
      </Link>
    </Panel>
  );
}
