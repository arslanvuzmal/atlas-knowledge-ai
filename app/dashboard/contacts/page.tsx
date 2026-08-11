import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listContacts } from '@/lib/crm/contact';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/ui';
import Link from 'next/link';

export default async function ContactsPage() {
  try {
    const workspace = await getCurrentWorkspaceContext();
    const { items = [], total = 0 } = await listContacts(workspace.id, { limit: 100 }).catch(
      () => ({ items: [], total: 0 }),
    );

    return (
      <div>
        <PageHeader
          title="Contacts"
          description={`${total} identified customer records with AI intelligence, lead scores, and activity history.`}
        />

        <Panel className="p-0">
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
              const lifecycle = contact.lifecycleStage || 'LEAD';
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
                    <Badge tone={lifecycle === 'CUSTOMER' ? 'good' : 'neutral'}>{lifecycle}</Badge>
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
