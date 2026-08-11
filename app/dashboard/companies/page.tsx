import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { listCompanies } from '@/lib/crm/company';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import Link from 'next/link';

export default async function CompaniesPage() {
  try {
    const workspace = await getCurrentWorkspaceContext();
    const { items, total } = await listCompanies(workspace.id, { limit: 100 });

    return (
      <div>
        <PageHeader
          title="Companies"
          description={`${total} registered customer and prospect companies.`}
        />

        <Panel className="p-0">
          <DataTable
            headers={[
              'Company Name',
              'Domain',
              'Industry',
              'Employee Range',
              'Country',
              'Lifecycle',
              'Contacts',
              'Deals',
            ]}
          >
            {items.map((company) => (
              <tr key={company.id} className="hover:bg-canvas-overlay/50 transition-colors">
                <Cell className="font-semibold text-ink">
                  <Link
                    href={`/dashboard/companies/${company.id}`}
                    className="hover:underline hover:text-accent"
                  >
                    {company.name}
                  </Link>
                </Cell>
                <Cell className="text-xs text-ink-muted">{company.domain || '—'}</Cell>
                <Cell>{company.industry || '—'}</Cell>
                <Cell>{company.employeeRange || '—'}</Cell>
                <Cell>{company.country || '—'}</Cell>
                <Cell>
                  <Badge tone={company.lifecycle === 'CUSTOMER' ? 'good' : 'neutral'}>
                    {company.lifecycle}
                  </Badge>
                </Cell>
                <Cell mono>{company._count.contacts}</Cell>
                <Cell mono>{company._count.deals}</Cell>
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
        <PageHeader title="Companies" description="Registered customer and prospect companies" />
        <Panel className="p-6 border-status-bad/40 bg-status-bad/10">
          <h2 className="text-sm font-bold text-status-bad">Companies Diagnostics Notice</h2>
          <p className="text-xs font-mono text-ink mt-2">{message}</p>
        </Panel>
      </div>
    );
  }
}
