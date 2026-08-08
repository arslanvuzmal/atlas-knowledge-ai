'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  InlineNote,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { Tabs, TabList, TabTrigger, TabPanel } from '@/components/ui/tabs';
import { AccessLevelBadge } from '@/components/dashboard/status-badges';
import { formatNumber, formatRelative } from '@/lib/ui';
import type { AccessLevel } from '@prisma/client';

interface KnowledgeBaseDetailTabsProps {
  base: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    visibility: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
    owner: { name: string | null; email: string } | null;
    createdAt: Date;
    documents: {
      id: string;
      title: string;
      sourceType: string;
      accessLevel: AccessLevel;
      status: string;
      fileSize: number;
      pageCount: number | null;
      chunkCount: number;
      createdAt: Date;
      updatedAt: Date;
    }[];
    citationMap: Map<string, number>;
    conversationCount: number;
    questionCount: number;
    totalPassages: number;
    levelsPresent: AccessLevel[];
    staleDocs: { id: string; updatedAt: Date }[];
    oldestIndexed: Date | null;
    canManage: boolean;
    canReprocess: boolean;
  };
}

export function KnowledgeBaseDetailTabs({ base }: KnowledgeBaseDetailTabsProps) {
  const [activeTab, setActiveTab] = useState('overview');

  const citedDocs = base.documents
    .map((d) => ({ ...d, citations: base.citationMap.get(d.id) ?? 0 }))
    .filter((d) => d.citations > 0)
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 10);

  const unusedDocs = base.documents
    .filter((d) => d.status === 'INDEXED' && !base.citationMap.has(d.id))
    .slice(0, 10);

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabList className="mb-6">
          <TabTrigger value="overview">Overview</TabTrigger>
          <TabTrigger value="sources">Sources ({formatNumber(base.documents.length)})</TabTrigger>
          <TabTrigger value="access">Access</TabTrigger>
          <TabTrigger value="quality">Quality</TabTrigger>
          <TabTrigger value="evaluation">Evaluation</TabTrigger>
          {base.canManage && <TabTrigger value="settings">Settings</TabTrigger>}
        </TabList>

        <TabPanel value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <PanelHeader
                title="Activity"
                description="Conversations and questions in this knowledge base"
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-md border border-edge bg-canvas-sunken p-4">
                  <p className="text-2xl font-semibold tabular-nums text-ink">
                    {formatNumber(base.conversationCount)}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">Conversations</p>
                </div>
                <div className="rounded-md border border-edge bg-canvas-sunken p-4">
                  <p className="text-2xl font-semibold tabular-nums text-ink">
                    {formatNumber(base.questionCount)}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">Questions asked</p>
                </div>
                <div className="rounded-md border border-edge bg-canvas-sunken p-4">
                  <p className="text-2xl font-semibold tabular-nums text-ink">
                    {formatNumber(base.totalPassages)}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">Retrievable passages</p>
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Document health"
                description="State of documents in this knowledge base"
              />
              <div className="space-y-3">
                {[
                  {
                    label: 'Indexed',
                    value: base.documents.filter((d) => d.status === 'INDEXED').length,
                    tone: 'good' as const,
                  },
                  {
                    label: 'Processing',
                    value: base.documents.filter((d) =>
                      ['UPLOADED', 'VALIDATING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING'].includes(
                        d.status,
                      ),
                    ).length,
                    tone: 'accent' as const,
                  },
                  {
                    label: 'Failed',
                    value: base.documents.filter((d) => d.status === 'FAILED').length,
                    tone: 'critical' as const,
                  },
                  {
                    label: 'Archived',
                    value: base.documents.filter((d) => d.status === 'ARCHIVED').length,
                    tone: 'neutral' as const,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 p-3 rounded-md bg-canvas-sunken"
                  >
                    <span className="text-sm text-ink-muted">{item.label}</span>
                    <Badge tone={item.tone}>{formatNumber(item.value)}</Badge>
                  </div>
                ))}
              </div>
              {base.documents.filter((d) => d.status === 'FAILED').length > 0 &&
              base.canReprocess ? (
                <div className="mt-4 border-t border-edge pt-3">
                  <a
                    href={`/dashboard/documents?kb=${base.id}&status=FAILED`}
                    className="text-sm text-accent hover:text-accent-soft"
                  >
                    Review {base.documents.filter((d) => d.status === 'FAILED').length} failed
                    document
                    {base.documents.filter((d) => d.status === 'FAILED').length === 1 ? '' : 's'} →
                  </a>
                </div>
              ) : null}
            </Panel>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Access levels present"
                description="Documents you can see, grouped by classification"
              />
              <div className="flex flex-wrap gap-2">
                {base.levelsPresent.length === 0 ? (
                  <span className="text-sm text-ink-faint">No accessible documents</span>
                ) : (
                  base.levelsPresent.map((level) => <AccessLevelBadge key={level} level={level} />)
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Staleness" description="Documents not updated in 90+ days" />
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-muted">Stale documents</span>
                  <Badge tone={base.staleDocs.length > 0 ? 'warning' : 'good'}>
                    {formatNumber(base.staleDocs.length)} of{' '}
                    {formatNumber(base.documents.filter((d) => d.status === 'INDEXED').length)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-muted">Oldest indexed</span>
                  <span className="text-sm font-mono text-ink">
                    {base.oldestIndexed ? formatRelative(base.oldestIndexed) : '—'}
                  </span>
                </div>
                {base.staleDocs.length > 0 && (
                  <div className="border-t border-edge pt-3">
                    <a
                      href={`/dashboard/documents?kb=${base.id}&stale=true`}
                      className="text-sm text-accent hover:text-accent-soft"
                    >
                      View {base.staleDocs.length} stale document
                      {base.staleDocs.length === 1 ? '' : 's'} →
                    </a>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </TabPanel>

        <TabPanel value="sources">
          <Panel>
            {base.documents.length === 0 ? (
              <EmptyState
                title="No documents"
                description="Upload files, register URLs, or write entries to add knowledge."
                action={
                  <a
                    href={`/dashboard/upload?kb=${base.id}`}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
                  >
                    Add a document
                  </a>
                }
              />
            ) : (
              <>
                <DataTable
                  caption="Documents in this knowledge base"
                  headers={[
                    'Title',
                    'Type',
                    'Access',
                    'Status',
                    { label: 'Pages', align: 'right' },
                    { label: 'Passages', align: 'right' },
                    { label: 'Citations', align: 'right' },
                    { label: 'Updated', align: 'right' },
                  ]}
                >
                  {base.documents.map((doc) => (
                    <tr key={doc.id}>
                      <Cell>
                        <a
                          href={`/dashboard/documents/${doc.id}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {doc.title}
                        </a>
                      </Cell>
                      <Cell>
                        <Badge tone="neutral">{doc.sourceType}</Badge>
                      </Cell>
                      <Cell>
                        <AccessLevelBadge level={doc.accessLevel} />
                      </Cell>
                      <Cell>
                        <Badge
                          tone={
                            doc.status === 'INDEXED'
                              ? 'good'
                              : doc.status === 'FAILED'
                                ? 'critical'
                                : doc.status === 'ARCHIVED'
                                  ? 'neutral'
                                  : 'accent'
                          }
                        >
                          {doc.status}
                        </Badge>
                      </Cell>
                      <Cell align="right" mono>
                        {formatNumber(doc.pageCount ?? 0)}
                      </Cell>
                      <Cell align="right" mono>
                        {formatNumber(doc.chunkCount)}
                      </Cell>
                      <Cell align="right" mono>
                        {formatNumber(base.citationMap.get(doc.id) ?? 0)}
                      </Cell>
                      <Cell align="right">
                        <span className="text-xs text-ink-faint">
                          {formatRelative(doc.updatedAt)}
                        </span>
                      </Cell>
                    </tr>
                  ))}
                </DataTable>
              </>
            )}
          </Panel>
        </TabPanel>

        <TabPanel value="access">
          <Panel>
            <PanelHeader
              title="Access control summary"
              description="Which roles can retrieve which documents in this knowledge base"
            />
            <InlineNote tone="iris">
              Access is enforced at the <strong>document level</strong>, not the knowledge base
              level. A single knowledge base can hold documents at different access levels. The
              matrix below shows the reach of each role across this KB&apos;s documents.
            </InlineNote>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-edge">
                    <th className="text-left p-3 font-medium text-ink-muted">Role</th>
                    <th className="text-left p-3 font-medium text-ink-muted">Reaches</th>
                    <th className="text-left p-3 font-medium text-ink-muted">Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER', 'PUBLIC'].map((role) => {
                    const roleReach = (() => {
                      const allLevels: AccessLevel[] = [
                        'PUBLIC',
                        'CUSTOMER',
                        'EMPLOYEE',
                        'MANAGER',
                        'ADMIN',
                      ];
                      const roleIndex = allLevels.indexOf(role as AccessLevel);
                      return roleIndex >= 0
                        ? allLevels.slice(0, roleIndex + 1)
                        : (['PUBLIC'] as AccessLevel[]);
                    })();
                    const reachableDocs = base.documents.filter((d) =>
                      roleReach.includes(d.accessLevel),
                    );
                    return (
                      <tr key={role} className="border-b border-edge-subtle">
                        <td className="p-3 font-mono text-ink">{role}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {roleReach.map((level) => (
                              <AccessLevelBadge key={level} level={level} />
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-ink-muted">
                          {formatNumber(reachableDocs.length)} /{' '}
                          {formatNumber(base.documents.length)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </TabPanel>

        <TabPanel value="quality">
          <Panel>
            <PanelHeader
              title="Knowledge quality signals"
              description="Metrics derived from actual usage and retrieval performance"
            />
            <InlineNote>
              These indicators help identify which documents are earning their keep, which need
              updates, and where gaps exist.
            </InlineNote>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink">Most-cited sources</h3>
                {citedDocs.length === 0 ? (
                  <p className="text-sm text-ink-muted">No citations recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {citedDocs.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-3 p-2 rounded-md bg-canvas-sunken"
                      >
                        <a
                          href={`/dashboard/documents/${doc.id}`}
                          className="font-medium text-ink hover:text-accent truncate"
                        >
                          {doc.title}
                        </a>
                        <div className="flex items-center gap-2 shrink-0">
                          <AccessLevelBadge level={doc.accessLevel} />
                          <Badge tone="neutral">{formatNumber(doc.citations)} citations</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink">
                  Least useful (indexed, never cited)
                </h3>
                {unusedDocs.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    All indexed documents have been cited at least once.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {unusedDocs.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-3 p-2 rounded-md bg-canvas-sunken"
                      >
                        <a
                          href={`/dashboard/documents/${doc.id}`}
                          className="font-medium text-ink hover:text-accent truncate"
                        >
                          {doc.title}
                        </a>
                        <div className="flex items-center gap-2 shrink-0">
                          <AccessLevelBadge level={doc.accessLevel} />
                          <span className="text-xs text-ink-faint">
                            Updated {formatRelative(doc.updatedAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink">Potential conflicts</h3>
                <InlineNote tone="iris">
                  Heuristic detection of contradictory claims across approved sources. Flagged for
                  human review.
                </InlineNote>
                <p className="text-sm text-ink-muted mt-2">
                  Conflict detection runs at query time. Review escalation queue for triggered
                  cases.
                </p>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink">
                  Content gaps (low confidence)
                </h3>
                <InlineNote>
                  Topics users ask about that retrieve poorly. These are the documents worth writing
                  next.
                </InlineNote>
                <p className="text-sm text-ink-muted mt-2">
                  View the{' '}
                  <Link href="/dashboard/analytics" className="text-accent hover:text-accent-soft">
                    Analytics → Content gaps
                  </Link>{' '}
                  panel for clustered low-confidence questions.
                </p>
              </div>
            </div>
          </Panel>
        </TabPanel>

        <TabPanel value="evaluation">
          <Panel>
            <PanelHeader
              title="Evaluation workbench"
              description="Test representative questions against this knowledge base to regression-test retrieval and answer quality"
              action={
                <Link
                  href="/dashboard/evaluations"
                  className="text-xs text-accent hover:text-accent-soft"
                >
                  Open full workbench →
                </Link>
              }
            />
            <InlineNote>
              Define test cases with expected documents, concepts, and grounding. Run them against
              current settings to detect regressions from chunking, embedding, or reranking changes.
            </InlineNote>

            <div className="mt-6">
              <p className="text-sm text-ink-muted">
                The full evaluation workbench is available at{' '}
                <Link href="/dashboard/evaluations" className="text-accent hover:text-accent-soft">
                  /dashboard/evaluations
                </Link>
                . Create test suites per knowledge base, track history, and compare runs.
              </p>
            </div>
          </Panel>
        </TabPanel>

        {base.canManage && (
          <TabPanel value="settings">
            <Panel>
              <PanelHeader title="Knowledge base settings" />
              <form
                className="space-y-5 px-5 py-5"
                action={`/api/knowledge-bases/${base.id}`}
                method="POST"
              >
                <input type="hidden" name="_action" value="update" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink">
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      defaultValue={base.name}
                      className="field"
                      maxLength={120}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="slug" className="mb-1.5 block text-sm font-medium text-ink">
                      Slug
                    </label>
                    <input
                      id="slug"
                      name="slug"
                      defaultValue={base.slug}
                      className="field font-mono"
                      maxLength={60}
                      readOnly
                    />
                    <p className="mt-1.5 text-[11px] text-ink-faint">
                      Slugs are immutable after creation.
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="description"
                      className="mb-1.5 block text-sm font-medium text-ink"
                    >
                      Description
                    </label>
                    <textarea
                      id="description"
                      name="description"
                      defaultValue={base.description ?? ''}
                      className="field min-h-[80px]"
                      maxLength={500}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="visibility"
                      className="mb-1.5 block text-sm font-medium text-ink"
                    >
                      Visibility
                    </label>
                    <select
                      id="visibility"
                      name="visibility"
                      defaultValue={base.visibility}
                      className="field"
                    >
                      <option value="PUBLIC">Public</option>
                      <option value="INTERNAL">Internal</option>
                      <option value="RESTRICTED">Restricted</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
                  >
                    Save settings
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-edge-strong px-4 py-2 text-sm font-medium text-ink transition hover:border-status-warning hover:text-status-warning"
                    onClick={() => {
                      if (
                        confirm(
                          'Archive this knowledge base? All documents remain but the base will be hidden from lists.',
                        )
                      ) {
                        // TODO: implement archive
                      }
                    }}
                  >
                    Archive
                  </button>
                </div>
              </form>
            </Panel>
          </TabPanel>
        )}
      </Tabs>
    </>
  );
}
