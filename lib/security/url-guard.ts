import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF prevention for website ingestion.
 *
 * Validation happens in two stages, and both matter:
 *
 *   1. **Syntactic** - protocol, embedded credentials, port, and obviously
 *      internal hostnames are rejected without any network activity.
 *   2. **Resolved** - the hostname is resolved to its actual IP addresses and
 *      every one of them is checked against private/reserved ranges. Stage 1
 *      alone is defeated by a public DNS name that points at 169.254.169.254.
 *
 * Redirects are followed manually so that each hop is re-validated. A permitted
 * public URL that 302s to the metadata service must not be followed.
 */

export interface UrlValidationResult {
  ok: boolean;
  reason?: string;
  url?: URL;
  resolvedAddresses?: string[];
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Ports outside this set are almost never legitimate public web content and are
// frequently the target of SSRF probing.
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes.default.svc',
]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

interface Cidr {
  base: number;
  bits: number;
  label: string;
}

function cidr(notation: string, label: string): Cidr {
  const [ip, bitsRaw] = notation.split('/');
  return { base: ipv4ToInt(ip) ?? 0, bits: Number.parseInt(bitsRaw, 10), label };
}

const BLOCKED_V4: Cidr[] = [
  cidr('0.0.0.0/8', 'this network'),
  cidr('10.0.0.0/8', 'private network'),
  cidr('100.64.0.0/10', 'carrier-grade NAT'),
  cidr('127.0.0.0/8', 'loopback'),
  cidr('169.254.0.0/16', 'link-local / cloud metadata'),
  cidr('172.16.0.0/12', 'private network'),
  cidr('192.0.0.0/24', 'IETF protocol assignments'),
  cidr('192.0.2.0/24', 'documentation range'),
  cidr('192.88.99.0/24', '6to4 relay anycast'),
  cidr('192.168.0.0/16', 'private network'),
  cidr('198.18.0.0/15', 'benchmarking range'),
  cidr('198.51.100.0/24', 'documentation range'),
  cidr('203.0.113.0/24', 'documentation range'),
  cidr('224.0.0.0/4', 'multicast'),
  cidr('240.0.0.0/4', 'reserved'),
];

export function isBlockedIpv4(ip: string): { blocked: boolean; label?: string } {
  const value = ipv4ToInt(ip);
  if (value === null) return { blocked: true, label: 'unparseable address' };
  for (const range of BLOCKED_V4) {
    const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
    if ((value & mask) === (range.base & mask)) {
      return { blocked: true, label: range.label };
    }
  }
  return { blocked: false };
}

export function isBlockedIpv6(ip: string): { blocked: boolean; label?: string } {
  const normalised = ip.toLowerCase().split('%')[0];

  if (normalised === '::1') return { blocked: true, label: 'loopback' };
  if (normalised === '::') return { blocked: true, label: 'unspecified address' };

  // IPv4-mapped and IPv4-compatible forms delegate to the v4 rules.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalised);
  if (mapped) return isBlockedIpv4(mapped[1]);

  const firstHextet = normalised.split(':')[0];
  const value = Number.parseInt(firstHextet || '0', 16);
  if (Number.isFinite(value)) {
    if ((value & 0xfe00) === 0xfc00) return { blocked: true, label: 'unique local address' };
    if ((value & 0xffc0) === 0xfe80) return { blocked: true, label: 'link-local address' };
    if ((value & 0xff00) === 0xff00) return { blocked: true, label: 'multicast' };
  }
  if (normalised.startsWith('2001:db8')) return { blocked: true, label: 'documentation range' };

  return { blocked: false };
}

export function isBlockedAddress(ip: string): { blocked: boolean; label?: string } {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return { blocked: true, label: 'not a valid IP address' };
}

/** Stage 1: no network access. Exposed separately so it is unit-testable. */
export function validateUrlSyntax(raw: string): UrlValidationResult {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return { ok: false, reason: 'URL is empty.' };
  if (trimmed.length > 2048) return { ok: false, reason: 'URL exceeds 2048 characters.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'URL could not be parsed.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `Protocol "${url.protocol}" is not permitted. Only http and https URLs can be ingested.`,
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs containing embedded credentials are not permitted.' };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: `Port ${url.port} is not permitted.` };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname.length === 0) return { ok: false, reason: 'URL has no hostname.' };
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Hostname "${hostname}" refers to an internal service.` };
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: `Hostname "${hostname}" resolves to a private namespace.` };
  }
  // A bare hostname with no dot cannot be a public site and is often an
  // internal service name.
  if (!hostname.includes('.') && isIP(hostname) === 0) {
    return { ok: false, reason: `Hostname "${hostname}" is not a public domain name.` };
  }

  if (isIP(hostname) !== 0) {
    const check = isBlockedAddress(hostname);
    if (check.blocked) {
      return { ok: false, reason: `Address ${hostname} is in a blocked range (${check.label}).` };
    }
  }

  return { ok: true, url };
}

/** Stage 2: resolves DNS and checks every returned address. */
export async function validateUrlForFetch(raw: string): Promise<UrlValidationResult> {
  const syntax = validateUrlSyntax(raw);
  if (!syntax.ok || !syntax.url) return syntax;

  const hostname = syntax.url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname) !== 0) {
    return { ...syntax, resolvedAddresses: [hostname] };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: `Hostname "${hostname}" could not be resolved.` };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: `Hostname "${hostname}" returned no addresses.` };
  }

  for (const entry of addresses) {
    const check = isBlockedAddress(entry.address);
    if (check.blocked) {
      // Deliberately does not echo the resolved address back to the caller.
      return {
        ok: false,
        reason: `Hostname "${hostname}" resolves to a blocked address range (${check.label}).`,
      };
    }
  }

  return { ...syntax, resolvedAddresses: addresses.map((a) => a.address) };
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: string;
  finalUrl?: string;
  reason?: string;
  bytesRead?: number;
}

const DEFAULT_USER_AGENT = 'AtlasKnowledgeAI/1.0 (+approved-source-ingestion)';

/**
 * Fetches an approved URL with every hop validated, a hard byte ceiling, and a
 * wall-clock timeout. This is not a crawler: it retrieves exactly the single
 * page it is given and never follows links found in the response.
 */
export async function safeFetchDocument(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 3 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRedirects = options.maxRedirects ?? 3;

  let target = raw;
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const validation = await validateUrlForFetch(target);
    if (!validation.ok || !validation.url) {
      return { ok: false, reason: validation.reason ?? 'URL failed validation.' };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: 'Request timed out.' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);

    let response: Response;
    try {
      response = await fetch(validation.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        },
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      return { ok: false, reason: aborted ? 'Request timed out.' : 'Request failed.' };
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, reason: 'Redirect response had no destination.' };
      // Each redirect target goes back through full validation on the next pass.
      target = new URL(location, validation.url).toString();
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: `Source returned HTTP ${response.status}.`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return {
        ok: false,
        status: response.status,
        reason: `Source is ${Math.round(declaredLength / 1024)} KB, above the ${Math.round(maxBytes / 1024)} KB limit.`,
      };
    }

    // A missing or lying content-length is why the stream is also capped.
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, reason: 'Source returned an empty body.' };

    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        if (Date.now() > deadline) {
          await reader.cancel();
          return { ok: false, reason: 'Request timed out while reading the response.' };
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          return {
            ok: false,
            reason: `Source exceeded the ${Math.round(maxBytes / 1024)} KB download limit.`,
          };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, reason: 'Failed while reading the response body.' };
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      ok: true,
      status: response.status,
      contentType,
      body: buffer.toString('utf8'),
      finalUrl: validation.url.toString(),
      bytesRead: received,
    };
  }

  return { ok: false, reason: `Exceeded the maximum of ${maxRedirects} redirects.` };
}
