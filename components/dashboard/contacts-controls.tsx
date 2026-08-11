'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function ContactsControls({
  currentQuery = '',
  currentLifecycle = '',
  currentSort = 'activity_desc',
  currentPage = 1,
  currentLimit = 50,
  totalItems = 0,
}: {
  currentQuery?: string;
  currentLifecycle?: string;
  currentSort?: string;
  currentPage?: number;
  currentLimit?: number;
  totalItems?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(currentQuery);

  const updateParams = (newParams: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(newParams)) {
      if (val === null || val === '' || (val === 1 && key === 'page')) {
        params.delete(key);
      } else {
        params.set(key, String(val));
      }
    }
    startTransition(() => {
      router.push(`/dashboard/contacts?${params.toString()}`);
    });
  };

  const totalPages = Math.ceil(totalItems / currentLimit) || 1;

  return (
    <div className="p-3 border-b border-edge bg-canvas-sunken flex flex-wrap items-center justify-between gap-3">
      {/* Search Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParams({ q: query, page: 1 });
        }}
        className="flex gap-2 flex-1 min-w-[200px] max-w-md"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts by name, email, company..."
          className="w-full px-3 py-1.5 text-xs rounded border border-edge bg-canvas text-ink focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1.5 text-xs font-medium rounded bg-canvas-overlay border border-edge text-ink hover:bg-canvas-sunken"
        >
          {isPending ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* Lifecycle Filter */}
        <select
          value={currentLifecycle}
          onChange={(e) => updateParams({ lifecycle: e.target.value, page: 1 })}
          className="px-2.5 py-1.5 rounded border border-edge bg-canvas text-ink focus:outline-none focus:border-accent"
        >
          <option value="">All Lifecycles</option>
          <option value="VISITOR">Visitor</option>
          <option value="LEAD">Lead</option>
          <option value="QUALIFIED_LEAD">Qualified Lead</option>
          <option value="OPPORTUNITY">Opportunity</option>
          <option value="CUSTOMER">Customer</option>
          <option value="CHURNED">Churned</option>
        </select>

        {/* Sort Order */}
        <select
          value={currentSort}
          onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}
          className="px-2.5 py-1.5 rounded border border-edge bg-canvas text-ink focus:outline-none focus:border-accent"
        >
          <option value="activity_desc">Sort: Last Activity (Newest)</option>
          <option value="score_desc">Sort: Lead Score (Highest)</option>
          <option value="created_desc">Sort: Created (Newest)</option>
          <option value="name_asc">Sort: Name (A-Z)</option>
        </select>

        {/* Pagination Controls */}
        <div className="flex items-center gap-1 border-l border-edge pl-2 ml-1 text-ink-faint">
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={currentPage <= 1 || isPending}
            onClick={() => updateParams({ page: currentPage - 1 })}
            className="px-2 py-1 rounded border border-edge hover:bg-canvas-overlay disabled:opacity-40"
          >
            ‹
          </button>
          <button
            disabled={currentPage >= totalPages || isPending}
            onClick={() => updateParams({ page: currentPage + 1 })}
            className="px-2 py-1 rounded border border-edge hover:bg-canvas-overlay disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
