import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listTickets } from '@/lib/crm/ticket';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import { notFound } from 'next/navigation';

export default async function TicketsPage() {
  const workspace = await getCurrentWorkspaceContext();
  if (!workspace) notFound();
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
                {new Date(ticket.createdAt).toLocaleDateString()}
              </Cell>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  );
}
