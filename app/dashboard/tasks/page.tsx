import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listTasks } from '@/lib/crm/task';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import { formatDate } from '@/lib/ui';
import { notFound } from 'next/navigation';

export default async function TasksPage() {
  const workspace = await getCurrentWorkspaceContext();
  if (!workspace) notFound();
  const { items, total } = await listTasks(workspace.id, { limit: 100 });

  return (
    <div>
      <PageHeader title="Tasks" description={`${total} pending and completed follow-up actions.`} />

      <Panel className="p-0">
        <DataTable
          headers={['Task Title', 'Type', 'Priority', 'Status', 'Contact', 'Company', 'Due Date']}
        >
          {items.map((task) => (
            <tr key={task.id} className="hover:bg-canvas-overlay/50 transition-colors">
              <Cell className="font-semibold text-ink">{task.title}</Cell>
              <Cell>{task.type}</Cell>
              <Cell>
                <Badge tone={task.priority === 'HIGH' ? 'warning' : 'neutral'}>
                  {task.priority}
                </Badge>
              </Cell>
              <Cell>
                <Badge tone={task.status === 'COMPLETED' ? 'good' : 'neutral'}>{task.status}</Badge>
              </Cell>
              <Cell>{task.contact?.displayName || '—'}</Cell>
              <Cell>{task.company?.name || '—'}</Cell>
              <Cell mono className="text-xs">
                {formatDate(task.dueAt)}
              </Cell>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  );
}
