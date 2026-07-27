'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { AccessLevel } from '@prisma/client';
import { ACCESS_LEVEL_LABELS } from '@/lib/auth/rbac';
import { apiFetch, cn, csrfToken } from '@/lib/ui';

interface CommonProps {
  knowledgeBases: { id: string; name: string }[];
  assignableLevels: AccessLevel[];
  maxSizeMb: number;
  supportedExtensions: string[];
}

type Tab = 'file' | 'url' | 'text';

interface Outcome {
  tone: 'good' | 'bad' | 'warn';
  title: string;
  detail?: string;
  documentId?: string;
  warnings?: string[];
}

export function AddSourceForms(props: CommonProps) {
  const [tab, setTab] = useState<Tab>('file');

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'file', label: 'Upload a file', hint: 'PDF, Word, Markdown, text or CSV' },
    { id: 'url', label: 'Register a URL', hint: 'A single approved public web page' },
    { id: 'text', label: 'Write an entry', hint: 'A FAQ or note typed directly' },
  ];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Source type"
        className="flex flex-wrap gap-1 border-b border-edge px-5"
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition',
              tab === entry.id
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-5">
        <p className="mb-4 text-xs text-ink-faint">
          {tabs.find((entry) => entry.id === tab)?.hint}
        </p>
        {tab === 'file' ? <FileForm {...props} /> : null}
        {tab === 'url' ? <UrlForm {...props} /> : null}
        {tab === 'text' ? <TextForm {...props} /> : null}
      </div>
    </div>
  );
}

function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  const styles = {
    good: 'border-status-good/40 bg-status-good/10 text-status-good',
    warn: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
    bad: 'border-status-critical/40 bg-status-critical/10 text-status-critical',
  }[outcome.tone];

  return (
    <div role="status" className={cn('mt-4 rounded-md border px-4 py-3 text-sm', styles)}>
      <p className="font-medium">{outcome.title}</p>
      {outcome.detail ? <p className="mt-1 text-ink-muted">{outcome.detail}</p> : null}
      {outcome.warnings && outcome.warnings.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
          {outcome.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {outcome.documentId ? (
        <a
          href={`/dashboard/documents/${outcome.documentId}`}
          className="mt-2 inline-block text-xs text-accent hover:text-accent-soft"
        >
          Open the document →
        </a>
      ) : null}
    </div>
  );
}

function SharedFields({
  knowledgeBases,
  assignableLevels,
  knowledgeBaseId,
  setKnowledgeBaseId,
  accessLevel,
  setAccessLevel,
}: {
  knowledgeBases: { id: string; name: string }[];
  assignableLevels: AccessLevel[];
  knowledgeBaseId: string;
  setKnowledgeBaseId: (value: string) => void;
  accessLevel: AccessLevel;
  setAccessLevel: (value: AccessLevel) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="kb" className="mb-1.5 block text-sm font-medium text-ink">
          Knowledge base
        </label>
        <select
          id="kb"
          value={knowledgeBaseId}
          onChange={(event) => setKnowledgeBaseId(event.target.value)}
          className="field"
          required
        >
          {knowledgeBases.map((base) => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="access" className="mb-1.5 block text-sm font-medium text-ink">
          Access level
        </label>
        <select
          id="access"
          value={accessLevel}
          onChange={(event) => setAccessLevel(event.target.value as AccessLevel)}
          className="field"
          required
        >
          {assignableLevels.map((level) => (
            <option key={level} value={level}>
              {ACCESS_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Only roles at or above this level will ever retrieve this content.
        </p>
      </div>
    </div>
  );
}

function FileForm({
  knowledgeBases,
  assignableLevels,
  maxSizeMb,
  supportedExtensions,
}: CommonProps) {
  const router = useRouter();
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? '');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('PUBLIC');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setOutcome(null);

    const form = new FormData();
    form.set('file', file);
    form.set('knowledgeBaseId', knowledgeBaseId);
    form.set('accessLevel', accessLevel);
    if (title.trim()) form.set('title', title.trim());

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        body: form,
        headers: { 'x-atlas-csrf': csrfToken() },
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      setBusy(false);

      if (!response.ok) {
        setOutcome({
          tone: 'bad',
          title: payload.duplicateOf ? 'This file is already indexed' : 'Ingestion failed',
          detail: payload.error ?? `Request failed with status ${response.status}.`,
          documentId: payload.duplicateOf?.id,
        });
        return;
      }

      setOutcome({
        tone: payload.warnings?.length ? 'warn' : 'good',
        title: `Indexed into ${payload.chunkCount} retrievable passages`,
        detail: 'The document is now searchable for permitted roles.',
        documentId: payload.documentId,
        warnings: payload.warnings,
      });
      setFile(null);
      setTitle('');
      router.refresh();
    } catch {
      setBusy(false);
      setOutcome({ tone: 'bad', title: 'Upload failed', detail: 'Could not reach the server.' });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SharedFields
        knowledgeBases={knowledgeBases}
        assignableLevels={assignableLevels}
        knowledgeBaseId={knowledgeBaseId}
        setKnowledgeBaseId={setKnowledgeBaseId}
        accessLevel={accessLevel}
        setAccessLevel={setAccessLevel}
      />

      <div>
        <label htmlFor="file" className="mb-1.5 block text-sm font-medium text-ink">
          File
        </label>
        <input
          id="file"
          type="file"
          required
          accept={supportedExtensions.join(',')}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="field file:mr-3 file:rounded file:border-0 file:bg-canvas-overlay file:px-3 file:py-1 file:text-xs file:text-ink"
        />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          {supportedExtensions.join(', ')} · up to {maxSizeMb} MB. The file type is verified against
          its actual contents, not just its extension.
        </p>
      </div>

      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-ink">
          Title <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Defaults to the filename"
          className="field"
          maxLength={200}
        />
      </div>

      <button
        type="submit"
        disabled={busy || !file}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
      >
        {busy ? 'Processing…' : 'Upload and index'}
      </button>

      {busy ? (
        <p className="text-xs text-ink-muted">
          Validating, extracting, chunking, embedding, then indexing. Large files take a moment.
        </p>
      ) : null}

      {outcome ? <OutcomeNotice outcome={outcome} /> : null}
    </form>
  );
}

function UrlForm({ knowledgeBases, assignableLevels }: CommonProps) {
  const router = useRouter();
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? '');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('PUBLIC');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setOutcome(null);

    const result = await apiFetch<{ documentId: string; chunkCount: number; warnings: string[] }>(
      '/api/documents/url',
      {
        method: 'POST',
        body: JSON.stringify({
          url,
          knowledgeBaseId,
          accessLevel,
          title: title.trim() || undefined,
        }),
      },
    );
    setBusy(false);

    if (!result.ok) {
      setOutcome({ tone: 'bad', title: 'The URL could not be ingested', detail: result.error });
      return;
    }

    setOutcome({
      tone: 'good',
      title: `Indexed into ${result.data.chunkCount} retrievable passages`,
      documentId: result.data.documentId,
      warnings: result.data.warnings,
    });
    setUrl('');
    setTitle('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SharedFields
        knowledgeBases={knowledgeBases}
        assignableLevels={assignableLevels}
        knowledgeBaseId={knowledgeBaseId}
        setKnowledgeBaseId={setKnowledgeBaseId}
        accessLevel={accessLevel}
        setAccessLevel={setAccessLevel}
      />

      <div>
        <label htmlFor="url" className="mb-1.5 block text-sm font-medium text-ink">
          Page URL
        </label>
        <input
          id="url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/help/refunds"
          className="field"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          Exactly this one page is fetched. Links inside it are never followed. The hostname is
          resolved and checked against private and reserved address ranges before any request is
          made, and each redirect hop is re-validated.
        </p>
      </div>

      <div>
        <label htmlFor="url-title" className="mb-1.5 block text-sm font-medium text-ink">
          Title <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="url-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Defaults to the page title"
          className="field"
          maxLength={200}
        />
      </div>

      <button
        type="submit"
        disabled={busy || url.trim().length === 0}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
      >
        {busy ? 'Fetching…' : 'Fetch and index'}
      </button>

      {outcome ? <OutcomeNotice outcome={outcome} /> : null}
    </form>
  );
}

function TextForm({ knowledgeBases, assignableLevels }: CommonProps) {
  const router = useRouter();
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? '');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('PUBLIC');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceType, setSourceType] = useState<'FAQ' | 'MANUAL_ENTRY'>('FAQ');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setOutcome(null);

    const result = await apiFetch<{ documentId: string; chunkCount: number }>(
      '/api/documents/text',
      {
        method: 'POST',
        body: JSON.stringify({ knowledgeBaseId, accessLevel, title, body, sourceType }),
      },
    );
    setBusy(false);

    if (!result.ok) {
      setOutcome({ tone: 'bad', title: 'The entry could not be indexed', detail: result.error });
      return;
    }

    setOutcome({
      tone: 'good',
      title: `Indexed into ${result.data.chunkCount} retrievable passages`,
      documentId: result.data.documentId,
    });
    setTitle('');
    setBody('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SharedFields
        knowledgeBases={knowledgeBases}
        assignableLevels={assignableLevels}
        knowledgeBaseId={knowledgeBaseId}
        setKnowledgeBaseId={setKnowledgeBaseId}
        accessLevel={accessLevel}
        setAccessLevel={setAccessLevel}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="text-title" className="mb-1.5 block text-sm font-medium text-ink">
            Title
          </label>
          <input
            id="text-title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="field"
            maxLength={200}
          />
        </div>
        <div>
          <label htmlFor="text-type" className="mb-1.5 block text-sm font-medium text-ink">
            Entry type
          </label>
          <select
            id="text-type"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as 'FAQ' | 'MANUAL_ENTRY')}
            className="field"
          >
            <option value="FAQ">FAQ</option>
            <option value="MANUAL_ENTRY">Manual entry</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="text-body" className="mb-1.5 block text-sm font-medium text-ink">
          Content
        </label>
        <textarea
          id="text-body"
          required
          rows={10}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={'## How do I reset my password?\n\nUse the Forgot Password link…'}
          className="field font-mono text-[13px]"
          minLength={40}
        />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Markdown headings become section boundaries and are used as citation labels. {body.length}{' '}
          characters.
        </p>
      </div>

      <button
        type="submit"
        disabled={busy || body.trim().length < 40 || title.trim().length === 0}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-60"
      >
        {busy ? 'Indexing…' : 'Save and index'}
      </button>

      {outcome ? <OutcomeNotice outcome={outcome} /> : null}
    </form>
  );
}
