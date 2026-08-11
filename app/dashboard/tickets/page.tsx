import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listTickets } from '@/lib/crm/ticket';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/ui';

export default async function TicketsPage() {
  try {
    const workspace = await getCurrentWorkspaceContext();
    const { items, total } = await listTickets(workspace.id, { limit: 100 });

    return (
      <div>
        <PageHeader
          title="Support Tickets"
          description={`${total} durable customer support cases and SLA metrics.`}
        />

        <Panel className="p-0">
          <DataTable
            headers={[
              'Subject',
              'Priority',
              'Status',
              'Contact',
              'Company',
              'Assignee',
              'Created At',
            ]}
          >
            {items.map((ticket) => (
              <tr key={ticket.id} className="hover:bg-canvas-overlay/50 transition-colors">
                <Cell className="font-semibold text-ink">{ticket.subject}</Cell>
                <Cell>
                  <Badge
                    tone={
                      ticket.priority === 'HIGH' || ticket.priority === 'URGENT'
                        ? 'critical'
                        : 'neutral'
                    }
                  >
                    {ticket.priority}
                  </Badge>
                </Cell>
                <Cell>
                  <Badge tone={ticket.status === 'RESOLVED' ? 'good' : 'neutral'}>
                    {ticket.status}
                  </Badge>
                </Cell>
                <Cell>{ticket.contact?.displayName || '—'}</Cell>
                <Cell>{ticket.company?.name || '—'}</Cell>
                <Cell>{ticket.assignee?.name || 'Unassigned'}</Cell>
                <Cell mono className="text-xs">
                  {formatDate(ticket.createdAt)}
                </Cell>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="space-y-4">
        <PageHeader title="Support Tickets" description="Durable customer support cases" />
        <Panel className="p-6 border-status-bad/40 bg-status-bad/10">
          <h2 className="text-sm font-bold text-status-bad">Support Tickets Diagnostics Notice</h2>
          <p className="text-xs font-mono text-ink mt-2">{message}</p>
        </Panel>
      </div>
    );
  }
}
