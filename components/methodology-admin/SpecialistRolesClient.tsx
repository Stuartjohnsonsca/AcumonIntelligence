'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2, Check, UserCheck } from 'lucide-react';

interface Role {
  key: string;
  label: string;
  name: string;
  email: string;
  isActive: boolean;
}

export function SpecialistRolesClient({ initialRoles }: { initialRoles: Role[] }) {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(key: string, patch: Partial<Role>) {
    setRoles(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  }
  function addRole() {
    const base = 'custom_role';
    let key = base;
    let n = 2;
    while (roles.some(r => r.key === key)) key = `${base}_${n++}`;
    setRoles(prev => [...prev, { key, label: 'Custom Role', name: '', email: '', isActive: true }]);
  }
  function removeRole(key: string) {
    if (!confirm(`Remove the ${key} role? Existing review history stays intact.`)) return;
    setRoles(prev => prev.filter(r => r.key !== key));
  }
  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/methodology-admin/specialist-roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 2000);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <button onClick={addRole}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> Add custom role
        </button>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button onClick={saveAll} disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save all
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {roles.map(r => (
          <div key={r.key} className={`border rounded-lg p-3 ${r.isActive ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50/40'}`}>
            <div className="flex items-start gap-3">
              <UserCheck className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-1" />
              <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Label</label>
                  <input type="text" value={r.label} onChange={e => update(r.key, { label: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="Shown in the dropdown" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Key</label>
                  <input type="text" value={r.key} disabled
                    className="w-full text-xs font-mono text-slate-500 border border-slate-100 rounded px-2 py-1.5 bg-slate-50"
                    title="Internal key — fixed once created" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Name</label>
                  <input type="text" value={r.name} onChange={e => update(r.key, { name: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. Jane Smith" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Email</label>
                  <input type="email" value={r.email} onChange={e => update(r.key, { email: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="jane@firm.com" />
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none">
                  <input type="checkbox" checked={r.isActive} onChange={e => update(r.key, { isActive: e.target.checked })} />
                  Active
                </label>
                {!['ethics_partner', 'mrlo', 'management_board', 'acp'].includes(r.key) && (
                  <button onClick={() => removeRole(r.key)} className="text-slate-400 hover:text-red-600" title="Delete custom role">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
