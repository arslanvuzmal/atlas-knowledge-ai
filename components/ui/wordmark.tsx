import { cn } from '@/lib/ui';

/**
 * Atlas wordmark.
 *
 * The glyph is three converging retrieval paths resolving into a single
 * answer point: a literal depiction of what the product does, rather than a
 * generic AI motif.
 */
export function AtlasMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <rect x="1" y="1" width="30" height="30" rx="8" stroke="#242836" strokeWidth="1.5" />
      <path
        d="M8 9.5 L16 16 L8 22.5"
        stroke="#5a58c2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path
        d="M14 9.5 L22 16 L14 22.5"
        stroke="#00a3c3"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23.5" cy="16" r="2.5" fill="#00a3c3" />
    </svg>
  );
}

export function Wordmark({
  size = 28,
  className,
  showSubtitle,
}: {
  size?: number;
  className?: string;
  showSubtitle?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <AtlasMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          Atlas Knowledge AI
        </span>
        {showSubtitle ? (
          <span className="mt-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Secure retrieval platform
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Visible whenever the deployment is running on deterministic demo providers. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-iris/40 bg-iris-wash px-2.5 py-0.5 text-[11px] font-medium text-iris-soft',
        className,
      )}
      title="Running on deterministic demo providers. No paid AI credentials are configured."
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-iris" />
      Demo mode
    </span>
  );
}
