import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import { isPathWithinRoot } from '@/lib/security/files';
import { logger } from '@/lib/observability/logger';

/**
 * Storage abstraction.
 *
 * Two adapters share one interface. The local adapter writes under a root
 * directory and refuses any key that escapes it; the Supabase adapter talks to
 * the Storage REST API with the service-role key, which never leaves the
 * server. Binary objects are never stored in the database or in Git — only the
 * key is persisted, on the Document row.
 */

export interface StorageHealth {
  status: 'operational' | 'degraded' | 'misconfigured' | 'unavailable';
  detail: string;
  provider: 'local' | 'supabase';
  checkedAt: string;
}

export interface StorageAdapter {
  readonly provider: 'local' | 'supabase';
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /**
   * Short-lived access URL. The local adapter returns an application route that
   * performs its own permission check, so file access is authorised in both
   * deployments rather than being a bare public path.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  healthCheck(): Promise<StorageHealth>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_found' | 'denied' | 'io' | 'configuration',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Builds a collision-resistant, traversal-proof object key. */
export function buildStorageKey(documentId: string, version: number, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
  return `documents/${documentId}/v${version}/${safe}`;
}

class LocalStorageAdapter implements StorageAdapter {
  readonly provider = 'local' as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!isPathWithinRoot(this.root, key)) {
      throw new StorageError(`Storage key "${key}" escapes the storage root.`, 'denied');
    }
    return path.resolve(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<string> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const target = this.resolve(key);
    try {
      return await readFile(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new StorageError(`Stored object "${key}" was not found.`, 'not_found');
      }
      throw new StorageError(`Failed to read stored object "${key}".`, 'io');
    }
  }

  async remove(key: string): Promise<void> {
    const target = this.resolve(key);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new StorageError(`Failed to remove stored object "${key}".`, 'io');
      }
    }
  }

  async signedUrl(key: string): Promise<string> {
    // Routed through the app so the download is permission-checked server-side.
    return `/api/documents/file?key=${encodeURIComponent(key)}`;
  }

  async healthCheck(): Promise<StorageHealth> {
    const checkedAt = new Date().toISOString();
    const probeKey = `.health/${Date.now()}.txt`;
    try {
      await this.put(probeKey, Buffer.from('ok', 'utf8'));
      const readBack = await this.get(probeKey);
      await this.remove(probeKey);
      const ok = readBack.toString('utf8') === 'ok';
      return {
        status: ok ? 'operational' : 'degraded',
        detail: ok
          ? `Local filesystem storage at ${this.root} is readable and writable.`
          : 'Local storage write succeeded but the read-back did not match.',
        provider: 'local',
        checkedAt,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        detail: `Local storage is not writable: ${error instanceof Error ? error.message : 'unknown error'}`,
        provider: 'local',
        checkedAt,
      };
    }
  }
}

class SupabaseStorageAdapter implements StorageAdapter {
  readonly provider = 'supabase' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
      ...extra,
    };
  }

  private objectUrl(key: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/storage/v1/object/${this.bucket}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    const response = await fetch(this.objectUrl(key), {
      method: 'POST',
      headers: this.headers({
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': 'true',
      }),
      body: new Uint8Array(data),
    });
    if (!response.ok) {
      throw new StorageError(`Supabase Storage upload failed with HTTP ${response.status}.`, 'io');
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const response = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (response.status === 404) {
      throw new StorageError(`Stored object "${key}" was not found.`, 'not_found');
    }
    if (!response.ok) {
      throw new StorageError(`Supabase Storage read failed with HTTP ${response.status}.`, 'io');
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const response = await fetch(this.objectUrl(key), {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`Supabase Storage delete failed with HTTP ${response.status}.`, 'io');
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/storage/v1/object/sign/${this.bucket}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) {
      throw new StorageError(`Failed to sign object URL (HTTP ${response.status}).`, 'io');
    }
    const payload = (await response.json()) as { signedURL?: string };
    if (!payload.signedURL) {
      throw new StorageError('Supabase Storage returned no signed URL.', 'io');
    }
    return `${this.baseUrl.replace(/\/$/, '')}/storage/v1${payload.signedURL}`;
  }

  async healthCheck(): Promise<StorageHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, '')}/storage/v1/bucket/${this.bucket}`,
        { headers: this.headers() },
      );
      if (response.status === 404) {
        return {
          status: 'misconfigured',
          detail: `Bucket "${this.bucket}" does not exist in the configured Supabase project.`,
          provider: 'supabase',
          checkedAt,
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          status: 'misconfigured',
          detail: 'Supabase Storage rejected the configured service-role credential.',
          provider: 'supabase',
          checkedAt,
        };
      }
      if (!response.ok) {
        return {
          status: 'degraded',
          detail: `Supabase Storage responded with HTTP ${response.status}.`,
          provider: 'supabase',
          checkedAt,
        };
      }
      return {
        status: 'operational',
        detail: `Bucket "${this.bucket}" is reachable.`,
        provider: 'supabase',
        checkedAt,
      };
    } catch {
      return {
        status: 'unavailable',
        detail: 'Supabase Storage could not be reached.',
        provider: 'supabase',
        checkedAt,
      };
    }
  }
}

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  const config = env();

  if (config.STORAGE_PROVIDER === 'supabase') {
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
      // Environment validation already blocks this, but failing closed here
      // means a bypass cannot silently degrade to writing on a serverless disk.
      throw new StorageError(
        'Supabase storage is selected but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.',
        'configuration',
      );
    }
    cached = new SupabaseStorageAdapter(
      config.SUPABASE_URL,
      config.SUPABASE_SERVICE_ROLE_KEY,
      config.SUPABASE_STORAGE_BUCKET,
    );
  } else {
    const root = path.resolve(process.cwd(), config.LOCAL_STORAGE_ROOT);
    logger.debug('Using local storage adapter', { root });
    cached = new LocalStorageAdapter(root);
  }

  return cached;
}

export function resetStorageCache(): void {
  cached = null;
}
