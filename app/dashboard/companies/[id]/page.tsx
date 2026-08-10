import { getOrCreateDefaultWorkspace } from '@/lib/workspace/context';
import { getCompanyById } from '@/lib/crm/company';
import { PageHeader, Panel, PanelHeader, Badge, DataTable, Cell } from '@/components/ui/primitives';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getOrCreateDefaultWorkspace();

  const company = await getCompanyById(workspace.id, id);
  if (!company) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description={company.website || company.domain || 'No website registered'}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Industry</div>
          <div className="text-lg font-semibold text-ink mt-1">
            {company.industry || 'Unspecified'}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Employee Range</div>
          <div className="text-lg font-semibold text-ink mt-1">
            {company.employeeRange || 'Unspecified'}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Lifecycle</div>
          <div className="text-lg font-semibold text-ink mt-1">
            <Badge tone={company.lifecycle === 'CUSTOMER' ? 'good' : 'neutral'}>
              {company.lifecycle}
            </Badge>
          </div>
        </Panel>
      </div>

      <Panel className="p-5">
        <PanelHeader
          title="Associated Contacts"
          description={`${company.contacts.length} team members at ${company.name}`}
        />
        <DataTable headers={['Name', 'Email', 'Lifecycle', 'Lead Score', 'Last Activity']}>
          {company.contacts.map((c) => (
            <tr key={c.id}>
              <Cell className="font-semibold text-ink">
                <Link
                  href={`/dashboard/contacts/${c.id}`}
                  className="hover:underline hover:text-accent"
                >
                  {c.displayName}
                </Link>
              </Cell>
              <Cell>{c.primaryEmail || '—'}</Cell>
              <Cell>{c.lifecycleStage}</Cell>
              <Cell mono>{c.leadScore} pts</Cell>
              <Cell mono>{new Date(c.lastActivityAt).toLocaleDateString()}</Cell>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </div>
  );
}
