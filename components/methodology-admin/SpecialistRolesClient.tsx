'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2, Check, UserCheck, X, Users } from 'lucide-react';

/**
 * A single specialist role record stored on
 * methodologyTemplate.items.
 *
 * - `name` / `email` are the LEAD person for the role (the one who
 *   is escalated to by default and shown first in engagement-side
 *   dropdowns).
 * - `members[]` is the additional roster — same role, different
 *   people. Engagement teams pick from `[lead, ...members]` when
 *   assigning the role on the Opening tab.
 * - `isAuditRole` controls whether this role appears on engagement-
 *   side specialist pickers. Roles like ACP / Management Board are
 *   firm-global and are typically marked NOT an audit role; Ethics
 *   Partner / Tax / IT are typically audit roles.
 */
interface Member { name: string; email: string }
interface Role {
  key: string;
  label: string;
  name: string;
  email: string;
  isActive: boolean;
  isAuditRole?: boolean;
  members?: Member[];
}

// Roles that look at things globally across the firm rather than per
// engagement — these default to NOT being an audit role on first
// save. The admin can flip the checkbox if a particular firm wants
// to involve them per engagement.
const FIRM_GLOBAL_KEYS = new Set(['acp', 'management_board']);

export function SpecialistRolesClient({ initialRoles }: { initialRoles: Role[] }) {
  // Hydrate older saves that don't yet carry isAuditRole / members
  // so the UI never lands on `undefined` and the toggles render in
  // a known state.
  const [roles, setRoles] = useState<Role[]>(() => initialRoles.map(r => ({
    ...r,
    isAuditRole: r.isAuditRole ?? !FIRM_GLOBAL_KEYS.has(r.key),
    members: Array.isArray(r.members) ? r.members : [],
  })));
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
    setRoles(prev => [...prev, { key, label: 'Custom Role', name: '', email: '', isActive: true, isAuditRole: true, members: [] }]);
  }
  function removeRole(key: string) {
    if (!confirm(`Remove the ${key} role? Existing review history stays intact.`)) return;
    setRoles(prev => prev.filter(r => r.key !== key));
  }
  function addMember(key: string) {
    setRoles(prev => prev.map(r => r.key === key
      ? { ...r, members: [...(r.members || []), { name: '', email: '' }] }
      : r));
  }
  function updateMember(key: string, idx: number, patch: Partial<Member>) {
    setRoles(prev => prev.map(r => r.key === key
      ? { ...r, members: (r.members || []).map((m, i) => i === idx ? { ...m, ...patch } : m) }
      : r));
  }
  function removeMember(key: string, idx: number) {
    setRoles(prev => prev.map(r => r.key === key
      ? { ...r, members: (r.members || []).filter((_, i) => i !== idx) }
      : r));
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

      <div className="space-y-3">
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
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Lead — name</label>
                  <input type="text" value={r.name} onChange={e => update(r.key, { name: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. Jane Smith" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Lead — email</label>
                  <input type="email" value={r.email} onChange={e => update(r.key, { email: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="jane@firm.com" />
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none">
                  <input type="checkbox" checked={r.isActive} onChange={e => update(r.key, { isActive: e.target.checked })} />
                  Active
                </label>
                {/* "May be part of an audit" — gates whether this role
                    surfaces on engagement-side specialist pickers (Opening
                    tab). Defaults to true except for firm-global roles
                    like ACP / Management Board, which look at things
                    across the firm and shouldn't pollute every engagement
                    picker. */}
                <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none" title="Tick to make this role available on the Opening tab specialist picker">
                  <input type="checkbox" checked={!!r.isAuditRole} onChange={e => update(r.key, { isAuditRole: e.target.checked })} />
                  Audit role
                </label>
                {!['ethics_partner', 'mrlo', 'management_board', 'acp'].includes(r.key) && (
                  <button onClick={() => removeRole(r.key)} className="text-slate-400 hover:text-red-600" title="Delete custom role">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Additional members — same role, multiple people. The
                engagement team picks one of [lead, ...members] when
                assigning the role on the Opening tab. */}
            <div className="mt-3 ml-7">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  Additional members ({(r.members || []).length})
                </span>
                <button onClick={() => addMember(r.key)} className="text-[10px] text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Add member
                </button>
              </div>
              {(r.members || []).length === 0 ? (
                <p className="text-[10px] text-slate-400 italic">No additional members. Engagement teams will only see the Lead.</p>
              ) : (
                <div className="space-y-1.5">
                  {(r.members || []).map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={m.name}
                        onChange={e => updateMember(r.key, idx, { name: e.target.value })}
                        placeholder="Name"
                        className="flex-1 text-xs border border-slate-200 rounded px-2 py-1"
                      />
                      <input
                        type="email"
                        value={m.email}
                        onChange={e => updateMember(r.key, idx, { email: e.target.value })}
                        placeholder="email@firm.com"
                        className="flex-1 text-xs border border-slate-200 rounded px-2 py-1"
                      />
                      <button
                        onClick={() => removeMember(r.key, idx)}
                        className="text-slate-400 hover:text-red-600"
                        title="Remove member"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
