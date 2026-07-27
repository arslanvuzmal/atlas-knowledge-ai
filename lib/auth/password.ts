import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// `promisify` picks the 3-argument overload, so the options-carrying signature
// is restated here. Without it the cost parameters would be silently dropped.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// OWASP-aligned scrypt parameters. N=2^15 with r=8 costs roughly 32 MB of
// memory per hash, which is a meaningful brute-force barrier while staying
// comfortably inside a serverless function's memory budget.
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const PREFIX = 'scrypt';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/**
 * Password policy. Deliberately favours length over character-class rules,
 * which is both more usable and more effective.
 */
export function validatePasswordStrength(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must be no more than ${PASSWORD_MAX_LENGTH} characters.`);
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password));
  if (classes.length < 3) {
    errors.push('Password must combine at least three of: lowercase, uppercase, numbers, symbols.');
  }
  if (/^(.)\1+$/.test(password)) {
    errors.push('Password must not be a single repeated character.');
  }
  return { valid: errors.length === 0, errors };
}

/** Produces `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)) as Buffer;
  const { N, r, p } = SCRYPT_PARAMS;
  return [PREFIX, N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

/** Constant-time verification. Returns false for malformed stored hashes. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  try {
    const derived = (await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    })) as Buffer;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
