import { getOrCreateDefaultWorkspace } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';

export default async function AutomationsPage() {
  const workspace = await getOrCreateDefaultWorkspace();

  const rules = await prisma.automationRule.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <PageHeader
        title="Workspace Automations"
        description="Trigger workflows, rule conditions, and automated background actions."
      />

      <Panel className="p-0">
        <DataTable headers={['Rule Name', 'Trigger Event', 'Status', 'Conditions Count', 'Actions Count', 'Created At']}>
          {rules.map((rule) => {
            const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
            const actions = Array.isArray(rule.actions) ? rule.actions : [];

            return (
              <tr key={rule.id} className="hover:bg-canvas-overlay/50 transition-colors">
                <Cell className="font-semibold text-ink">{rule.name}</Cell>
                <Cell>
                  <Badge tone="accent">{rule.trigger}</Badge>
                </Cell>
                <Cell>
                  <Badge tone={rule.active ? 'good' : 'neutral'}>
                    {rule.active ? 'Active' : 'Disabled'}
                  </Badge>
                </Cell>
                <Cell mono>{conditions.length} conditions</Cell>
                <Cell mono>{actions.length} actions</Cell>
                <Cell mono className="text-xs">
                  {new Date(rule.createdAt).toLocaleDateString()}
                </Cell>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
    </div>
  );
}
