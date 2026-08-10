import { getOrCreateDefaultWorkspace } from '@/lib/workspace/context';
import { listCompanies } from '@/lib/crm/company';
import { PageHeader, Panel, DataTable, Cell, Badge } from '@/components/ui/primitives';
import Link from 'next/link';

export default async function CompaniesPage() {
  const workspace = await getOrCreateDefaultWorkspace();
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
                <Link href={`/dashboard/companies/${company.id}`} className="hover:underline hover:text-accent">
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
}
