import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listContacts, type ListContactsOptions } from '@/lib/crm/contact';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/ui';
import Link from 'next/link';
import type { LifecycleStage } from '@prisma/client';
import { ContactsControls } from '@/components/dashboard/contacts-controls';

export const dynamic = 'force-dynamic';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    lifecycle?: string;
    sort?: string;
    page?: string;
    limit?: string;
  }>;
}) {
  try {
    const params = await searchParams;
    const q = params.q || '';
    const lifecycle = (params.lifecycle || '').toUpperCase() as LifecycleStage | '';
    const sort = (params.sort || 'activity_desc') as ListContactsOptions['sort'];
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(params.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const workspace = await getCurrentWorkspaceContext();
    const { items = [], total = 0 } = await listContacts(workspace.id, {
      query: q,
      lifecycleStage: lifecycle || undefined,
      sort,
      limit,
      offset,
    }).catch(() => ({ items: [], total: 0 }));

    return (
      <div>
        <PageHeader
          title="Contacts"
          description={`${total} identified customer records with AI intelligence, lead scores, and activity history.`}
        />

        <Panel className="p-0 overflow-hidden">
          <ContactsControls
            currentQuery={q}
            currentLifecycle={lifecycle}
            currentSort={sort}
            currentPage={page}
            currentLimit={limit}
            totalItems={total}
          />

          {items.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-faint">
              No contacts found matching specified criteria.
            </div>
          ) : (
            <DataTable
              headers={[
                'Name',
                'Company',
                'Lifecycle',
                'Lead Status',
                'Lead Score',
                'Primary Intent',
                'Last Activity',
                'Source',
              ]}
            >
              {items.map((contact) => {
                if (!contact) return null;
                const contactLifecycle = contact.lifecycleStage || 'LEAD';
                const leadStatus = contact.leadStatus || 'NEW';
                const leadScore = contact.leadScore ?? 0;

                return (
                  <tr key={contact.id} className="hover:bg-canvas-overlay/50 transition-colors">
                    <Cell className="font-semibold text-ink">
                      <Link
                        href={`/dashboard/contacts/${contact.id}`}
                        className="hover:underline hover:text-accent"
                      >
                        {contact.displayName || contact.primaryEmail || 'Unnamed Contact'}
                      </Link>
                      {contact.primaryEmail ? (
                        <span className="block text-[11px] font-normal text-ink-faint">
                          {contact.primaryEmail}
                        </span>
                      ) : null}
                    </Cell>
                    <Cell>{contact.company?.name || '—'}</Cell>
                    <Cell>
                      <Badge tone={contactLifecycle === 'CUSTOMER' ? 'good' : 'neutral'}>
                        {contactLifecycle}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Badge tone={leadStatus === 'QUALIFIED' ? 'good' : 'neutral'}>
                        {leadStatus}
                      </Badge>
                    </Cell>
                    <Cell mono className="font-bold">
                      <span className={leadScore >= 70 ? 'text-status-good' : 'text-ink'}>
                        {leadScore} pts
                      </span>
                    </Cell>
                    <Cell>{contact.intelligence?.primaryIntent || '—'}</Cell>
                    <Cell mono className="text-xs">
                      {formatDate(contact.lastActivityAt)}
                    </Cell>
                    <Cell className="text-xs">{contact.source || 'Website Chat'}</Cell>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Panel>
      </div>
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="space-y-4">
        <PageHeader title="Contacts" description="Identified customer records" />
        <Panel className="p-6 border-status-bad/40 bg-status-bad/10">
          <h2 className="text-sm font-bold text-status-bad">Contacts Diagnostics Notice</h2>
          <p className="text-xs font-mono text-ink mt-2">{message}</p>
        </Panel>
      </div>
    );
  }
}
