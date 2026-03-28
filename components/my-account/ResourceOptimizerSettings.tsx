'use client';

import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Save, Loader2, ShieldAlert, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BREAKABLE_CONSTRAINTS, HARD_CONSTRAINTS } from '@/lib/resource-planning/optimizer-constraints';

export function ResourceOptimizerSettings() {
  const [order, setOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/resource-planning/optimizer-settings')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.constraintOrder)) setOrder(data.constraintOrder);
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  function move(index: number, direction: -1 | 1) {
    const newOrder = [...order];
    const target = index + direction;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setOrder(newOrder);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/resource-planning/optimizer-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ constraintOrder: order }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Save failed');
      } else {
        setSaved(true);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-slate-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading optimizer settings…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* Hard constraints — read only */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Lock className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Hard Constraints</h3>
          <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Never breakable</span>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          These constraints can never be violated. They are enforced regardless of priority settings.
        </p>
        <div className="space-y-2">
          {HARD_CONSTRAINTS.map((c) => (
            <div key={c.id} className="flex items-start gap-3 border border-red-100 rounded-lg px-3 py-2.5 bg-red-50">
              <ShieldAlert className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-700">{c.label}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{c.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Breakable constraints — reorderable */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Breakable Constraint Priority Order</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              The optimiser avoids breaking constraints near the top of this list before those near
              the bottom. Use the arrows to reorder.
            </p>
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <div className="space-y-1.5 mb-4">
          {order.map((id, i) => {
            const def = BREAKABLE_CONSTRAINTS.find((c) => c.id === id);
            if (!def) return null;
            return (
              <div
                key={id}
                className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2.5 bg-white hover:bg-slate-50 transition-colors"
              >
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">{def.label}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed truncate">{def.description}</p>
                </div>
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === order.length - 1}
                    className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave} disabled={saving} className="text-xs h-8">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            {saving ? 'Saving…' : 'Save Priority Order'}
          </Button>
          {saved && (
            <span className="text-xs text-green-700 font-medium">Priority order saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}
