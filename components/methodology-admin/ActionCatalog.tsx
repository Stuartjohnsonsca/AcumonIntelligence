'use client';

import { useState } from 'react';
import { X, Search, FileSearch, Landmark, Database, Target, Sparkles, AlertTriangle, Calendar, Scale, CheckCircle, UserCheck } from 'lucide-react';
import { getCategoryStyle, type ActionCategory, ACTION_CATEGORIES } from '@/lib/action-registry';
import type { InputFieldDef, OutputFieldDef } from '@/lib/action-registry';

export interface ActionDefinitionItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  inputSchema: InputFieldDef[];
  outputSchema: OutputFieldDef[];
}

interface Props {
  actions: ActionDefinitionItem[];
  onSelect: (action: ActionDefinitionItem) => void;
  onClose: () => void;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileSearch, Landmark, Database, Target, Sparkles, AlertTriangle, Calendar, Scale, CheckCircle, UserCheck,
};

export function getActionIcon(iconName: string | null) {
  if (!iconName) return null;
  const Icon = ICON_MAP[iconName];
  return Icon || null;
}

export function ActionCatalog({ actions, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');

  const filtered = actions.filter(a => {
    if (filterCategory && a.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Group by category
  const grouped = ACTION_CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(a => a.category === cat.value);
    if (items.length > 0) acc.push({ ...cat, items });
    return acc;
  }, [] as (typeof ACTION_CATEGORIES[0] & { items: ActionDefinitionItem[] })[]);

  // Add ungrouped
  const categorized = new Set(ACTION_CATEGORIES.map(c => c.value));
  const uncategorized = filtered.filter(a => !categorized.has(a.category as ActionCategory));
  if (uncategorized.length > 0) {
    grouped.push({ value: 'other' as ActionCategory, label: 'Other', color: 'bg-slate-100 text-slate-600', items: uncategorized });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-base font-semibold text-slate-900">Add Action</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {/* Search + Filter */}
        <div className="px-5 py-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search actions..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-300"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilterCategory('')}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${!filterCategory ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >All</button>
            {ACTION_CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => setFilterCategory(filterCategory === cat.value ? '' : cat.value)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${filterCategory === cat.value ? 'bg-slate-800 text-white' : `${cat.color} hover:opacity-80`}`}
              >{cat.label}</button>
            ))}
          </div>
        </div>

        {/* Action List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {grouped.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">No actions found</div>
          )}
          {grouped.map(group => (
            <div key={group.value} className="mb-4">
              <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{group.label}</h4>
              <div className="space-y-1">
                {group.items.map(action => {
                  const Icon = getActionIcon(action.icon);
                  return (
                    <button
                      key={action.id}
                      onClick={() => onSelect(action)}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50/50 transition-colors text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-slate-100" style={{ color: action.color || '#64748b' }}>
                        {Icon && <Icon className="h-4 w-4 text-current" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800 group-hover:text-blue-700">{action.name}</span>
                          {action.isSystem && <span className="text-[8px] px-1 py-0 rounded bg-slate-100 text-slate-400 font-medium">SYSTEM</span>}
                        </div>
                        {action.description && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{action.description}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] text-slate-300">{action.inputSchema.filter(f => f.source === 'user').length} inputs</span>
                          <span className="text-[9px] text-slate-300">{action.outputSchema.length} outputs</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
