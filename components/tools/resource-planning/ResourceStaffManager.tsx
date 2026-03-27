'use client';

import { useState, useEffect } from 'react';
import { Users, RefreshCw, Loader2, Check, Search } from 'lucide-react';

interface CRMUser {
  crmId: string;
  name: string;
  email: string;
  title: string | null;
  inDb: boolean;
  dbUserId: string | null;
  isResourceVisible: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ResourceStaffManager({ isOpen, onClose }: Props) {
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) loadUsers();
  }, [isOpen]);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/resource-planning/sync-users');
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.users);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncFromCRM() {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const res = await fetch('/api/resource-planning/sync-users', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const data = await res.json();
      setSyncResult(`Synced: ${data.created} new users created (${data.total} total in CRM)`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
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
        setUsers(prev => prev.map(u =>
          u.email === user.email ? { ...u, isResourceVisible: !u.isResourceVisible } : u
        ));
      }
    } catch {} finally {
      setToggling(prev => { const s = new Set(prev); s.delete(user.email); return s; });
    }
  }

  if (!isOpen) return null;

  const filtered = search
    ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users;

  const visibleCount = users.filter(u => u.isResourceVisible).length;
  const inDbCount = users.filter(u => u.inDb).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-slate-900">Manage Resource Staff</h3>
            <span className="text-xs text-slate-400">{visibleCount} visible / {users.length} total</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={syncFromCRM} disabled={syncing}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50">
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync from CRM
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg px-2">×</button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        </div>

        {/* Status messages */}
        {error && (
          <div className="mx-5 mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        )}
        {syncResult && (
          <div className="mx-5 mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">{syncResult}</div>
        )}

        {/* User list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-1">
              {/* Quick toggle bar */}
              <div className="flex items-center gap-3 py-2 mb-2 text-xs text-slate-500">
                <span>{filtered.length} users</span>
                <span>•</span>
                <span>{inDbCount} in system</span>
                <span>•</span>
                <button onClick={() => {
                  // Select all filtered that are in DB
                  filtered.filter(u => u.inDb && !u.isResourceVisible).forEach(u => toggleVisibility(u));
                }} className="text-indigo-600 hover:text-indigo-800 font-medium">Show All</button>
                <button onClick={() => {
                  filtered.filter(u => u.isResourceVisible).forEach(u => toggleVisibility(u));
                }} className="text-red-500 hover:text-red-700 font-medium">Hide All</button>
              </div>

              {filtered.map(user => (
                <div key={user.email}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                    user.isResourceVisible
                      ? 'bg-green-50/50 border-green-200'
                      : user.inDb ? 'bg-white border-slate-100 hover:border-slate-200' : 'bg-slate-50/50 border-slate-100 opacity-60'
                  }`}>
                  {/* Checkbox */}
                  <button
                    onClick={() => user.inDb && toggleVisibility(user)}
                    disabled={!user.inDb || toggling.has(user.email)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      user.isResourceVisible
                        ? 'bg-green-500 border-green-500 text-white'
                        : user.inDb ? 'bg-white border-slate-300 hover:border-green-400' : 'bg-slate-100 border-slate-200 cursor-not-allowed'
                    }`}
                  >
                    {toggling.has(user.email) ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : user.isResourceVisible ? (
                      <Check className="h-3 w-3" />
                    ) : null}
                  </button>

                  {/* User info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{user.name}</span>
                      {user.title && <span className="text-[10px] text-slate-400 truncate">{user.title}</span>}
                    </div>
                    <span className="text-xs text-slate-400">{user.email}</span>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!user.inDb && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">Not in system</span>
                    )}
                    {user.isResourceVisible && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Visible</span>
                    )}
                  </div>
                </div>
              ))}

              {filtered.length === 0 && !loading && (
                <div className="text-center py-8 text-sm text-slate-400">
                  {search ? 'No users match your search' : 'No users found. Click "Sync from CRM" to import.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-slate-50/50 text-xs text-slate-400">
          Check users to show them in the Resource Planner left panel. Users marked "Not in system" need to be synced first.
        </div>
      </div>
    </div>
  );
}
