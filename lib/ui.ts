/** Minimal class-name joiner. Avoids a dependency for five lines of logic. */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatRelative(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ];

  const formatter = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  let previous = 1;
  for (const [limit, unit] of steps) {
    if (Math.abs(seconds) < limit) {
      return formatter.format(-Math.round(seconds / previous), unit);
    }
    previous = limit;
  }
  return formatter.format(-Math.round(seconds / 31557600), 'year');
}

/** Reads the double-submit CSRF cookie for fetch calls from the browser. */
export function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = /(?:^|;\s*)atlas_csrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : '';
}

/** Wrapper that attaches the CSRF header and normalises error handling. */
export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const headers = new Headers(options.headers);
  const token = csrfToken();
  if (token) headers.set('x-atlas-csrf', token);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          typeof payload.error === 'string'
            ? payload.error
            : `Request failed with status ${response.status}.`,
      };
    }
    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection.' };
  }
}
