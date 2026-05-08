'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Workflow, FileSearch, Target, Sparkles, CheckCircle, UserCheck, AlertTriangle, Database, Calendar, Upload, FileText, Download, Loader2 } from 'lucide-react';

interface ActionDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  handlerName: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  inputSchema: any[];
  outputSchema: any[];
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  evidence: { label: 'Evidence', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200' },
  sampling: { label: 'Sampling', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200' },
  analysis: { label: 'Analysis', color: 'text-purple-700', bgColor: 'bg-purple-50 border-purple-200' },
  verification: { label: 'Verification', color: 'text-green-700', bgColor: 'bg-green-50 border-green-200' },
  reporting: { label: 'Reporting', color: 'text-slate-700', bgColor: 'bg-slate-50 border-slate-200' },
};

const ICON_MAP: Record<string, any> = {
  FileSearch, Target, Sparkles, CheckCircle, UserCheck, AlertTriangle, Database, Calendar, Upload, FileText, Download, Workflow,
};

export function PipelinesClient() {
  const [actions, setActions] = useState<ActionDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<string>('all');

  useEffect(() => {
    fetch('/api/methodology-admin/action-definitions')
      .then(r => r.ok ? r.json() : { actions: [] })
      .then(data => {
        setActions(data.actions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const filtered = filterCategory === 'all' ? actions : actions.filter(a => a.category === filterCategory);
  const categories = [...new Set(actions.map(a => a.category))].sort();

  // Group by category
  const grouped = categories.reduce((acc, cat) => {
    acc[cat] = filtered.filter(a => a.category === cat);
    return acc;
  }, {} as Record<string, ActionDefinition[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-2 text-slate-500">Loading action definitions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Filter:</span>
        <button
          onClick={() => setFilterCategory('all')}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            filterCategory === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
          }`}
        >
          All ({actions.length})
        </button>
        {categories.map(cat => {
          const cfg = CATEGORY_CONFIG[cat] || { label: cat, color: 'text-slate-600', bgColor: 'bg-slate-50 border-slate-200' };
          const count = actions.filter(a => a.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                filterCategory === cat ? 'bg-slate-800 text-white border-slate-800' : `${cfg.bgColor} ${cfg.color}`
              }`}
            >
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Actions by category */}
      {Object.entries(grouped).map(([category, catActions]) => {
        if (catActions.length === 0) return null;
        const cfg = CATEGORY_CONFIG[category] || { label: category, color: 'text-slate-600', bgColor: 'bg-slate-50 border-slate-200' };
        return (
          <div key={category}>
            <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${cfg.color}`}>
              {cfg.label}
            </h2>
            <div className="space-y-2">
              {catActions.map(action => {
                const isExpanded = expandedIds.has(action.id);
                const IconComponent = ICON_MAP[action.icon || ''] || Workflow;
                return (
                  <div key={action.id} className={`border rounded-lg overflow-hidden ${cfg.bgColor}`}>
                    <button
                      onClick={() => toggleExpand(action.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/50 transition-colors"
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: action.color || '#6366f1' }}>
                        <IconComponent className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{action.name}</span>
                          <code className="text-[9px] px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded font-mono">{action.code}</code>
                          {action.isSystem && <span className="text-[8px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full font-medium">System</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{action.description}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-200/50 bg-white/30">
                        <p className="text-xs text-slate-600 mb-3">{action.description}</p>

                        {action.handlerName && (
                          <div className="mb-3">
                            <span className="text-[10px] font-medium text-slate-500 uppercase">Handler: </span>
                            <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-700">{action.handlerName}</code>
                          </div>
                        )}

                        {action.inputSchema?.length > 0 && (
                          <div className="mb-3">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Inputs</h4>
                            <div className="space-y-1">
                              {action.inputSchema.map((input: any, i: number) => (
                                <div key={i} className="flex items-start gap-2 text-[11px]">
                                  <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-600 flex-shrink-0">{input.code}</code>
                                  <span className="text-slate-400">{input.type}</span>
                                  <span className="text-slate-500">{input.label}</span>
                                  {input.required && <span className="text-red-400 text-[9px]">required</span>}
                                  {input.source === 'auto' && <span className="text-blue-400 text-[9px]">auto</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {action.outputSchema?.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Outputs</h4>
                            <div className="space-y-1">
                              {action.outputSchema.map((output: any, i: number) => (
                                <div key={i} className="flex items-start gap-2 text-[11px]">
                                  <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-600 flex-shrink-0">{output.code}</code>
                                  <span className="text-slate-400">{output.type}</span>
                                  <span className="text-slate-500">{output.label}</span>
                                  {output.description && <span className="text-slate-400 italic text-[10px]">— {output.description}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {actions.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Workflow className="h-10 w-10 mx-auto mb-3" />
          <p className="text-sm">No action definitions found. Run the seed to create system actions.</p>
        </div>
      )}
    </div>
  );
}
