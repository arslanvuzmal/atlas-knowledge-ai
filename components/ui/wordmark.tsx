import { cn } from '@/lib/ui';

/**
 * Atlas Brand Mark.
 *
 * Minimal geometric 'A' constructed from two structural outer lines and a horizontal
 * evidence/indexing reference line. Flat, unornamented, precise. Works cleanly at
 * 16px favicon, 24px sidebar, and 32px marketing displays.
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
      {/* Outer bounding frame */}
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="4"
        stroke="rgba(255,255,255,0.13)"
        strokeWidth="1.2"
        fill="#0D0F12"
      />
      {/* Left structural line */}
      <path d="M9 23 L16 8" stroke="#7799D8" strokeWidth="2" strokeLinecap="round" />
      {/* Right structural line */}
      <path d="M16 8 L23 23" stroke="#7799D8" strokeWidth="2" strokeLinecap="round" />
      {/* Evidence index reference line */}
      <path d="M12 17.5 H20" stroke="#73B5AF" strokeWidth="2" strokeLinecap="round" />
      {/* Reference point index dot */}
      <circle cx="20" cy="17.5" r="1.5" fill="#73B5AF" />
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
        <span className="text-[14.5px] font-semibold tracking-tight text-ink font-sans">
          Atlas Knowledge AI
        </span>
        {showSubtitle ? (
          <span className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Grounded Knowledge System
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
        'inline-flex items-center gap-1.5 rounded border border-indigo/30 bg-indigo-wash px-2 py-0.5 font-mono text-[11px] font-medium text-indigo',
        className,
      )}
      title="Running on deterministic demo providers. No paid AI credentials are required."
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-indigo" />
      DEMO_MODE
    </span>
  );
}
