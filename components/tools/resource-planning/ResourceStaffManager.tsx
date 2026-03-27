'use client';

import { useState, useEffect } from 'react';
import { Users, RefreshCw, Loader2, Check, Search, X } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';

interface CRMUser {
  crmId: string;
  name: string;
  email: string;
  title: string | null;
  inDb: boolean;
  dbUserId: string | null;
  isResourceVisible: boolean;
  resourceSetting: {
    resourceRole: string;
    weeklyCapacityHrs: number;
    overtimeHrs: number;
    preparerJobLimit: number | null;
    reviewerJobLimit: number | null;
    riJobLimit: number | null;
    specialistJobLimit: number | null;
  } | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ROLES = ['Specialist', 'Preparer', 'Reviewer', 'RI'];

export function ResourceStaffManager({ isOpen, onClose }: Props) {
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [savingSettings, setSavingSettings] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) loadUsers();
  }, [isOpen]);

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
    const key = user.email;
    setToggling(prev => new Set(prev).add(key));
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
            ...u,
            isResourceVisible: newVisible,
            resourceSetting: newVisible ? (u.resourceSetting || {
              resourceRole: 'Preparer', weeklyCapacityHrs: 37.5, overtimeHrs: 0,
              preparerJobLimit: 5, reviewerJobLimit: null, riJobLimit: null, specialistJobLimit: null,
            }) : null,
          } : u
        ));
        setHasChanges(true);
        if (newVisible) setExpandedUser(user.email);
      }
    } catch {} finally {
      setToggling(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }

  async function saveSettings(user: CRMUser, settings: NonNullable<CRMUser['resourceSetting']>) {
    if (!user.dbUserId) return;
    setSavingSettings(prev => new Set(prev).add(user.email));
    try {
      await fetch('/api/resource-planning/sync-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.dbUserId,
          visible: true,
          settings: {
            resourceRole: settings.resourceRole,
            weeklyCapacityHrs: settings.weeklyCapacityHrs,
            overtimeHrs: settings.overtimeHrs,
            preparerJobLimit: settings.preparerJobLimit,
            reviewerJobLimit: settings.reviewerJobLimit,
            riJobLimit: settings.riJobLimit,
            specialistJobLimit: settings.specialistJobLimit,
          },
        }),
      });
      setUsers(prev => prev.map(u =>
        u.email === user.email ? { ...u, resourceSetting: settings } : u
      ));
      setHasChanges(true);
    } catch {} finally {
      setSavingSettings(prev => { const s = new Set(prev); s.delete(user.email); return s; });
    }
  }

  function handleClose() {
    if (hasChanges) {
      // Reload the page to refresh server-side staff data
      window.location.reload();
    } else {
      onClose();
    }
  }

  if (!isOpen) return null;

  const filtered = search
    ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()) || (u.title || '').toLowerCase().includes(search.toLowerCase()))
    : users;

  const visibleCount = users.filter(u => u.isResourceVisible).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-slate-900">Manage Resource Staff</h3>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{visibleCount} active</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={syncFromCRM} disabled={syncing}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50">
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync from CRM
            </button>
            <button onClick={handleClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, or title..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
        </div>

        {/* Messages */}
        {error && <div className="mx-5 mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
        {syncResult && <div className="mx-5 mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">{syncResult}</div>}

        {/* User list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : (
            <div className="space-y-1">
              {filtered.map(user => (
                <div key={user.email} className="border rounded-lg overflow-hidden">
                  {/* User row */}
                  <div className={`flex items-center gap-3 px-3 py-2 transition-colors ${
                    user.isResourceVisible ? 'bg-green-50/50' : user.inDb ? 'bg-white' : 'bg-slate-50/50 opacity-60'
                  }`}>
                    {/* Audit Resource checkbox */}
                    <button
                      onClick={() => user.inDb && toggleVisibility(user)}
                      disabled={!user.inDb || toggling.has(user.email)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        user.isResourceVisible ? 'bg-green-500 border-green-500 text-white' : user.inDb ? 'bg-white border-slate-300 hover:border-green-400' : 'bg-slate-100 border-slate-200 cursor-not-allowed'
                      }`}
                    >
                      {toggling.has(user.email) ? <Loader2 className="h-3 w-3 animate-spin" /> : user.isResourceVisible ? <Check className="h-3 w-3" /> : null}
                    </button>

                    {/* User info */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => user.isResourceVisible && setExpandedUser(expandedUser === user.email ? null : user.email)}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">{user.name}</span>
                        {user.title && <span className="text-[10px] text-slate-400 truncate">{user.title}</span>}
                      </div>
                      <span className="text-xs text-slate-400">{user.email}</span>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {!user.inDb && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">Not synced</span>}
                      {user.isResourceVisible && user.resourceSetting && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                          {user.resourceSetting.resourceRole}
                        </span>
                      )}
                      {user.isResourceVisible && (
                        <button onClick={() => setExpandedUser(expandedUser === user.email ? null : user.email)}
                          className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium">
                          {expandedUser === user.email ? 'Hide' : 'Settings'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded settings */}
                  {expandedUser === user.email && user.isResourceVisible && user.resourceSetting && (
                    <InlineSettings user={user} settings={user.resourceSetting}
                      saving={savingSettings.has(user.email)}
                      onSave={(s) => saveSettings(user, s)} />
                  )}
                </div>
              ))}

              {filtered.length === 0 && !loading && (
                <div className="text-center py-8 text-sm text-slate-400">
                  {search ? 'No users match' : 'No users. Click "Sync from CRM".'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50/50 flex items-center justify-between">
          <span className="text-xs text-slate-400">Check "Audit Resource" to add staff to the planner. Click "Settings" to configure roles and limits.</span>
          <button onClick={handleClose} className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Done</button>
        </div>
      </div>
    </div>
  );
}

function InlineSettings({ user, settings, saving, onSave }: {
  user: CRMUser;
  settings: NonNullable<CRMUser['resourceSetting']>;
  saving: boolean;
  onSave: (s: NonNullable<CRMUser['resourceSetting']>) => void;
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
      resourceRole: role,
      weeklyCapacityHrs: weeklyHrs,
      overtimeHrs: overtime,
      preparerJobLimit: prepLimit,
      reviewerJobLimit: revLimit,
      riJobLimit: riLimit,
      specialistJobLimit: specLimit,
    });
  }

  return (
    <div className="bg-slate-50 px-4 py-3 border-t border-slate-200">
      <div className="grid grid-cols-4 gap-3 text-xs">
        {/* Primary Role */}
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Primary Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs bg-white">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* Weekly Hours */}
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Weekly Hours</label>
          <input type="number" value={weeklyHrs} onChange={e => setWeeklyHrs(parseFloat(e.target.value) || 0)}
            step="0.5" className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs" />
        </div>

        {/* Overtime */}
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Overtime Hrs/Week</label>
          <input type="number" value={overtime} onChange={e => setOvertime(parseFloat(e.target.value) || 0)}
            step="0.5" className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs" />
        </div>

        {/* Save button */}
        <div className="flex items-end">
          <button onClick={handleSave} disabled={saving}
            className="w-full px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-1">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save
          </button>
        </div>
      </div>

      {/* Role Eligibility & Job Limits */}
      <div className="mt-3">
        <label className="text-[10px] text-slate-500 block mb-1.5">Role Eligibility & Job Limits</label>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Preparer', value: prepLimit, set: setPrepLimit },
            { label: 'Reviewer', value: revLimit, set: setRevLimit },
            { label: 'RI', value: riLimit, set: setRiLimit },
            { label: 'Specialist', value: specLimit, set: setSpecLimit },
          ].map(({ label, value, set }) => (
            <div key={label} className={`flex items-center gap-2 px-2 py-1.5 rounded border ${value !== null ? 'bg-white border-blue-200' : 'bg-slate-100/50 border-slate-200'}`}>
              <input type="checkbox" checked={value !== null}
                onChange={e => set(e.target.checked ? 5 : null)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600" />
              <span className="text-[10px] text-slate-600 flex-1">{label}</span>
              {value !== null && (
                <input type="number" value={value} onChange={e => set(parseInt(e.target.value) || 0)}
                  min={0} max={99}
                  className="w-10 border border-slate-200 rounded px-1 py-0.5 text-[10px] text-center" />
              )}
            </div>
          ))}
        </div>
        <p className="text-[9px] text-slate-400 mt-1">Check to make eligible for role. Number = max concurrent jobs in that role.</p>
      </div>
    </div>
  );
}
