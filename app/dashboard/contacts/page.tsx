import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listContacts } from '@/lib/crm/contact';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/ui';
import Link from 'next/link';

export default async function ContactsPage() {
  try {
    const workspace = await getCurrentWorkspaceContext();
    const { items, total } = await listContacts(workspace.id, { limit: 100 });

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
            {items.map((contact) => (
              <tr key={contact.id} className="hover:bg-canvas-overlay/50 transition-colors">
                <Cell className="font-semibold text-ink">
                  <Link
                    href={`/dashboard/contacts/${contact.id}`}
                    className="hover:underline hover:text-accent"
                  >
                    {contact.displayName}
                  </Link>
                  {contact.primaryEmail ? (
                    <span className="block text-[11px] font-normal text-ink-faint">
                      {contact.primaryEmail}
                    </span>
                  ) : null}
                </Cell>
                <Cell>{contact.company?.name || '—'}</Cell>
                <Cell>
                  <Badge tone={contact.lifecycleStage === 'CUSTOMER' ? 'good' : 'neutral'}>
                    {contact.lifecycleStage}
                  </Badge>
                </Cell>
                <Cell>
                  <Badge tone={contact.leadStatus === 'QUALIFIED' ? 'good' : 'neutral'}>
                    {contact.leadStatus}
                  </Badge>
                </Cell>
                <Cell mono className="font-bold">
                  <span className={contact.leadScore >= 70 ? 'text-status-good' : 'text-ink'}>
                    {contact.leadScore} pts
                  </span>
                </Cell>
                <Cell>{contact.intelligence?.primaryIntent || '—'}</Cell>
                <Cell mono className="text-xs">
                  {formatDate(contact.lastActivityAt)}
                </Cell>
                <Cell className="text-xs">{contact.source}</Cell>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    return (
      <div className="space-y-4">
        <PageHeader title="Contacts" description="Identified customer records" />
        <Panel className="p-6 border-status-bad/40 bg-status-bad/10">
          <h2 className="text-sm font-bold text-status-bad">Contacts Diagnostics Notice</h2>
          <p className="text-xs font-mono text-ink mt-2">{message}</p>
          {stack ? (
            <pre className="text-[10px] font-mono text-ink-faint mt-2 overflow-x-auto">{stack}</pre>
          ) : null}
        </Panel>
      </div>
    );
  }
}
