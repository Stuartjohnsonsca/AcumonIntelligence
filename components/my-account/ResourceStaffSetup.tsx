'use client';

import { useState, useEffect } from 'react';
import { Users, RefreshCw, Loader2, Check, Search, Save } from 'lucide-react';

interface CRMUser {
  crmId: string;
  name: string;
  email: string;
  title: string | null;
  inDb: boolean;
  dbUserId: string | null;
  isResourceVisible: boolean;
  resourceSetting: ResourceSettings | null;
}

interface ResourceSettings {
  resourceRole: string;
  weeklyCapacityHrs: number;
  overtimeHrs: number;
  preparerJobLimit: number | null;
  reviewerJobLimit: number | null;
  riJobLimit: number | null;
  specialistJobLimit: number | null;
}

const ROLES = ['Specialist', 'Preparer', 'Reviewer', 'RI'];

export function ResourceStaffSetup() {
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [savingSettings, setSavingSettings] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/resource-planning/sync-users');
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.users);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function syncFromCRM() {
    setSyncing(true); setError(null); setSyncResult(null);
    try {
      const res = await fetch('/api/resource-planning/sync-users', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setSyncResult(`${data.created} new users synced (${data.total} in CRM)`);
      await loadUsers();
    } catch (err: any) { setError(err.message); }
    finally { setSyncing(false); }
  }

  async function toggleVisibility(user: CRMUser) {
    if (!user.dbUserId) return;
    setToggling(prev => new Set(prev).add(user.email));
    try {
      const res = await fetch('/api/resource-planning/sync-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.dbUserId, visible: !user.isResourceVisible }),
      });
      if (res.ok) {
        const newVisible = !user.isResourceVisible;
        setUsers(prev => prev.map(u =>
          u.email === user.email ? {
            ...u, isResourceVisible: newVisible,
            resourceSetting: newVisible ? (u.resourceSetting || {
              resourceRole: 'Preparer', weeklyCapacityHrs: 37.5, overtimeHrs: 0,
              preparerJobLimit: 5, reviewerJobLimit: null, riJobLimit: null, specialistJobLimit: null,
            }) : null,
          } : u
        ));
        if (newVisible) setExpandedUser(user.email);
      }
    } catch {} finally {
      setToggling(prev => { const s = new Set(prev); s.delete(user.email); return s; });
    }
  }

  async function saveSettings(user: CRMUser, settings: ResourceSettings) {
    if (!user.dbUserId) return;
    setSavingSettings(prev => new Set(prev).add(user.email));
    try {
      await fetch('/api/resource-planning/sync-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.dbUserId, visible: true, settings }),
      });
      setUsers(prev => prev.map(u =>
        u.email === user.email ? { ...u, resourceSetting: settings } : u
      ));
    } catch {} finally {
      setSavingSettings(prev => { const s = new Set(prev); s.delete(user.email); return s; });
    }
  }

  const filtered = users.filter(u => {
    if (filterMode === 'active' && !u.isResourceVisible) return false;
    if (filterMode === 'inactive' && u.isResourceVisible) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.title || '').toLowerCase().includes(q);
    }
    return true;
  });

  const visibleCount = users.filter(u => u.isResourceVisible).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Staff Setup</h2>
          <p className="text-sm text-slate-500">Sync users from CRM and configure who appears in the Resource Planner</p>
        </div>
        <button onClick={syncFromCRM} disabled={syncing}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync from CRM
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">{error}</div>}
      {syncResult && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 mb-4">{syncResult}</div>}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, or title..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400" />
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(['all', 'active', 'inactive'] as const).map(mode => (
            <button key={mode} onClick={() => setFilterMode(mode)}
              className={`px-3 py-2 text-xs font-medium ${filterMode === mode ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
              {mode === 'all' ? `All (${users.length})` : mode === 'active' ? `Active (${visibleCount})` : `Inactive (${users.length - visibleCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* User list */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[40px_1fr_120px_100px_80px_80px] gap-0 bg-slate-100 border-b border-slate-200 px-3 py-2 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <div>Audit</div>
            <div>Name / Email</div>
            <div>Title</div>
            <div>Primary Role</div>
            <div className="text-center">Weekly Hrs</div>
            <div className="text-center">Settings</div>
          </div>

          {/* Rows */}
          <div className="max-h-[60vh] overflow-y-auto">
            {filtered.map(user => (
              <div key={user.email} className="border-b border-slate-100 last:border-b-0">
                <div className={`grid grid-cols-[40px_1fr_120px_100px_80px_80px] gap-0 items-center px-3 py-2 transition-colors ${
                  user.isResourceVisible ? 'bg-green-50/30' : user.inDb ? 'bg-white' : 'bg-slate-50/50 opacity-50'
                }`}>
                  {/* Checkbox */}
                  <div>
                    <button onClick={() => user.inDb && toggleVisibility(user)}
                      disabled={!user.inDb || toggling.has(user.email)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                        user.isResourceVisible ? 'bg-green-500 border-green-500 text-white' : user.inDb ? 'bg-white border-slate-300 hover:border-green-400' : 'bg-slate-100 border-slate-200 cursor-not-allowed'
                      }`}>
                      {toggling.has(user.email) ? <Loader2 className="h-3 w-3 animate-spin" /> : user.isResourceVisible ? <Check className="h-3 w-3" /> : null}
                    </button>
                  </div>

                  {/* Name/Email */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{user.name}</div>
                    <div className="text-xs text-slate-400 truncate">{user.email}</div>
                  </div>

                  {/* Title */}
                  <div className="text-xs text-slate-500 truncate">{user.title || '—'}</div>

                  {/* Primary Role */}
                  <div className="text-xs">
                    {user.isResourceVisible && user.resourceSetting ? (
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{user.resourceSetting.resourceRole}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </div>

                  {/* Weekly Hrs */}
                  <div className="text-xs text-center">
                    {user.isResourceVisible && user.resourceSetting ? (
                      <span>{user.resourceSetting.weeklyCapacityHrs}h</span>
                    ) : <span className="text-slate-300">—</span>}
                  </div>

                  {/* Settings button */}
                  <div className="text-center">
                    {user.isResourceVisible && (
                      <button onClick={() => setExpandedUser(expandedUser === user.email ? null : user.email)}
                        className={`text-xs px-2 py-1 rounded ${expandedUser === user.email ? 'bg-indigo-100 text-indigo-700' : 'text-indigo-500 hover:bg-indigo-50'}`}>
                        {expandedUser === user.email ? 'Close' : 'Edit'}
                      </button>
                    )}
                    {!user.inDb && <span className="text-[9px] text-amber-600">Sync first</span>}
                  </div>
                </div>

                {/* Expanded inline settings */}
                {expandedUser === user.email && user.isResourceVisible && user.resourceSetting && (
                  <InlineSettings user={user} settings={user.resourceSetting}
                    saving={savingSettings.has(user.email)}
                    onSave={(s) => saveSettings(user, s)} />
                )}
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-400">
                {search ? 'No users match your search' : 'No users found. Click "Sync from CRM" to import.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InlineSettings({ user, settings, saving, onSave }: {
  user: CRMUser; settings: ResourceSettings; saving: boolean;
  onSave: (s: ResourceSettings) => void;
}) {
  const [role, setRole] = useState(settings.resourceRole);
  const [weeklyHrs, setWeeklyHrs] = useState(settings.weeklyCapacityHrs);
  const [overtime, setOvertime] = useState(settings.overtimeHrs);
  const [prepLimit, setPrepLimit] = useState<number | null>(settings.preparerJobLimit);
  const [revLimit, setRevLimit] = useState<number | null>(settings.reviewerJobLimit);
  const [riLimit, setRiLimit] = useState<number | null>(settings.riJobLimit);
  const [specLimit, setSpecLimit] = useState<number | null>(settings.specialistJobLimit);

  function handleSave() {
    onSave({
      resourceRole: role, weeklyCapacityHrs: weeklyHrs, overtimeHrs: overtime,
      preparerJobLimit: prepLimit, reviewerJobLimit: revLimit, riJobLimit: riLimit, specialistJobLimit: specLimit,
    });
  }

  return (
    <div className="bg-slate-50 px-4 py-3 border-t border-slate-200">
      <div className="grid grid-cols-5 gap-3 text-xs">
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Primary Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs bg-white">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Weekly Hours</label>
          <input type="number" value={weeklyHrs} onChange={e => setWeeklyHrs(parseFloat(e.target.value) || 0)}
            step="0.5" className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Overtime Hrs/Week</label>
          <input type="number" value={overtime} onChange={e => setOvertime(parseFloat(e.target.value) || 0)}
            step="0.5" className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs" />
        </div>
        <div className="col-span-2 flex items-end">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Settings
          </button>
        </div>
      </div>

      <div className="mt-3">
        <label className="text-[10px] text-slate-500 block mb-1.5">Role Eligibility</label>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Preparer', value: prepLimit, set: setPrepLimit },
            { label: 'Reviewer', value: revLimit, set: setRevLimit },
            { label: 'RI', value: riLimit, set: setRiLimit },
            { label: 'Specialist', value: specLimit, set: setSpecLimit },
          ].map(({ label, value, set }) => (
            <div key={label} className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer ${value !== null ? 'bg-blue-50 border-blue-300' : 'bg-slate-100/50 border-slate-200'}`}
              onClick={() => set(value !== null ? null : 99)}>
              <input type="checkbox" checked={value !== null} readOnly
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 pointer-events-none" />
              <span className="text-[10px] text-slate-600 select-none">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
