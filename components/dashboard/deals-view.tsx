'use client';

import { useState } from 'react';
import { Panel, Badge, DataTable, Cell } from '@/components/ui/primitives';

export interface DealItem {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  status: string;
  stageId: string;
  stageName: string;
  companyName?: string | null;
  contactName?: string | null;
  ownerName?: string | null;
}

export interface PipelineStageItem {
  id: string;
  name: string;
  order: number;
}

export function DealsView({ deals, stages }: { deals: DealItem[]; stages: PipelineStageItem[] }) {
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');

  const sortedStages = [...stages].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 border border-edge rounded p-0.5 bg-canvas text-xs">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1 rounded font-medium ${viewMode === 'kanban' ? 'bg-accent text-white' : 'text-ink-muted'}`}
          >
            Kanban Board
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 rounded font-medium ${viewMode === 'table' ? 'bg-accent text-white' : 'text-ink-muted'}`}
          >
            Table View
          </button>
        </div>
      </div>

      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-8 gap-3 overflow-x-auto pb-4">
          {sortedStages.map((st) => {
            const stageDeals = deals.filter((d) => d.stageId === st.id);
            const totalVal = stageDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

            return (
              <div
                key={st.id}
                className="min-w-[200px] flex flex-col rounded border border-edge bg-canvas-sunken/40 p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between pb-2 border-b border-edge">
                  <span className="text-xs font-semibold text-ink">{st.name}</span>
                  <span className="text-[10px] text-ink-faint">({stageDeals.length})</span>
                </div>
                <div className="text-[10px] font-bold text-accent">
                  ${totalVal.toLocaleString()}
                </div>

                <div className="space-y-2 flex-1 overflow-y-auto">
                  {stageDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="p-3 rounded border border-edge bg-canvas-overlay shadow-xs text-xs space-y-1.5"
                    >
                      <div className="font-semibold text-ink leading-snug">{deal.name}</div>
                      {deal.companyName ? (
                        <div className="text-[11px] text-ink-muted">{deal.companyName}</div>
                      ) : null}
                      <div className="flex items-center justify-between pt-1">
                        <span className="font-bold text-accent">
                          ${deal.amount?.toLocaleString() ?? '0'}
                        </span>
                        <Badge tone={deal.status === 'WON' ? 'good' : 'neutral'}>
                          {deal.status}
                        </Badge>
                      </div>
                    </div>
                  ))}

                  {stageDeals.length === 0 ? (
                    <div className="text-[11px] text-ink-faint text-center py-4">Empty stage</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Panel className="p-0">
          <DataTable headers={['Deal Name', 'Stage', 'Amount', 'Company', 'Contact', 'Status']}>
            {deals.map((deal) => (
              <tr key={deal.id}>
                <Cell className="font-semibold text-ink">{deal.name}</Cell>
                <Cell>{deal.stageName}</Cell>
                <Cell mono className="font-bold text-accent">
                  ${deal.amount?.toLocaleString() ?? 0}
                </Cell>
                <Cell>{deal.companyName || '—'}</Cell>
                <Cell>{deal.contactName || '—'}</Cell>
                <Cell>
                  <Badge tone={deal.status === 'WON' ? 'good' : 'neutral'}>{deal.status}</Badge>
                </Cell>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
