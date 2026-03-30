'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';

export interface ClientRow {
  id: string;
  clientName: string;
  software: string | null;
  contactFirstName: string | null;
  contactSurname: string | null;
  contactEmail: string | null;
  isActive: boolean;
  readOnly: boolean;
  createdAt: string;
  portfolioManager?: { id: string; name: string; email: string } | null;
  _count?: { subscriptions: number; userAssignments: number };
}

type SortKey = 'clientName' | 'software' | 'contactFirstName' | 'contactEmail';
type SortDir = 'asc' | 'desc';

interface Props {
  clients: ClientRow[];
  selectable?: 'single' | 'multi';
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onRowClick?: (client: ClientRow) => void;
  highlightedId?: string | null;
  showStatus?: boolean;
  compact?: boolean;
}

export function ClientListTable({
  clients,
  selectable,
  selectedIds = new Set(),
  onSelectionChange,
  onRowClick,
  highlightedId,
  showStatus = false,
  compact = false,
}: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('clientName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return clients
      .filter((c) => {
        if (!term) return true;
        return (
          c.clientName.toLowerCase().includes(term) ||
          (c.software || '').toLowerCase().includes(term) ||
          (c.contactFirstName || '').toLowerCase().includes(term) ||
          (c.contactSurname || '').toLowerCase().includes(term) ||
          (c.contactEmail || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        const av = (a[sortKey] || '').toLowerCase();
        const bv = (b[sortKey] || '').toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }, [clients, search, sortKey, sortDir]);

  function handleCheckbox(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    if (selectable === 'single') {
      if (next.has(id)) next.delete(id);
      else { next.clear(); next.add(id); }
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    onSelectionChange(next);
  }

  function SortHeader({ k, label }: { k: SortKey; label: string }) {
    return (
      <th className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} text-left`}>
        <button
          onClick={() => toggleSort(k)}
          className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase tracking-wide hover:text-slate-900"
        >
          {label}
          {sortKey === k ? (
            sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3 opacity-20" />
          )}
        </button>
      </th>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="pl-9 h-9"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {selectable && (
                <th className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} w-10`}>
                  {selectable === 'multi' && (
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
                      onChange={() => {
                        if (!onSelectionChange) return;
                        const allSelected = filtered.every((c) => selectedIds.has(c.id));
                        if (allSelected) onSelectionChange(new Set());
                        else onSelectionChange(new Set(filtered.map((c) => c.id)));
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  )}
                </th>
              )}
              <SortHeader k="clientName" label="Client Name" />
              {!compact && <SortHeader k="software" label="Software" />}
              {!compact && <SortHeader k="contactFirstName" label="Contact" />}
              {!compact && <SortHeader k="contactEmail" label="Email" />}
              {showStatus && (
                <th className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} text-left`}>
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Status</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  No clients found
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const isHighlighted = highlightedId === c.id;
                const isSelected = selectedIds.has(c.id);
                return (
                  <tr
                    key={c.id}
                    className={`transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-blue-50'
                        : isSelected
                          ? 'bg-blue-50/50'
                          : 'hover:bg-slate-50'
                    } ${!c.isActive ? 'opacity-60' : ''}`}
                    onClick={() => {
                      if (selectable) handleCheckbox(c.id);
                      else onRowClick?.(c);
                    }}
                  >
                    {selectable && (
                      <td className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleCheckbox(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                    )}
                    <td className={`${compact ? 'px-2 py-2' : 'px-3 py-3'} font-medium text-slate-800`}>
                      {c.clientName}
                      {c.readOnly && (
                        <Badge variant="secondary" className="ml-2 text-[10px] bg-amber-50 text-amber-700">
                          Read Only
                        </Badge>
                      )}
                    </td>
                    {!compact && <td className={`${compact ? 'px-2 py-2' : 'px-3 py-3'} text-slate-500`}>{c.software || '—'}</td>}
                    {!compact && <td className={`${compact ? 'px-2 py-2' : 'px-3 py-3'} text-slate-500`}>{`${c.contactFirstName || ''} ${c.contactSurname || ''}`.trim() || '—'}</td>}
                    {!compact && <td className={`${compact ? 'px-2 py-2' : 'px-3 py-3'} text-slate-500`}>{c.contactEmail || '—'}</td>}
                    {showStatus && (
                      <td className={`${compact ? 'px-2 py-2' : 'px-3 py-3'}`}>
                        <Badge
                          variant={c.isActive ? 'default' : 'secondary'}
                          className={c.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}
                        >
                          {c.isActive ? (c.readOnly ? 'Read Only' : 'Active') : 'Archived'}
                        </Badge>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
    </div>
  );
}
