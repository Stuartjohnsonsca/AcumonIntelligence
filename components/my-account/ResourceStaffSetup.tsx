'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, Search } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  isAuditStaff: boolean;
}

export function ResourceStaffSetup() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(await res.json());
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function toggleAudit(user: User) {
    setToggling(prev => new Set(prev).add(user.id));
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAuditStaff: !user.isAuditStaff }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isAuditStaff: !u.isAuditStaff } : u));
      }
    } catch {}
    finally { setToggling(prev => { const s = new Set(prev); s.delete(user.id); return s; }); }
  }

  const filtered = search
    ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users;

  const auditCount = users.filter(u => u.isAuditStaff).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Staff Setup</h2>
          <p className="text-sm text-slate-500">Tick Audit to include a user in User Settings and the Resource Planner.</p>
        </div>
        <span className="text-sm text-slate-500">{auditCount} of {users.length} assigned to Audit</span>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">{error}</div>}

      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[48px_1fr_200px] bg-slate-100 border-b border-slate-200 px-3 py-2 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <div>Audit</div>
            <div>Name / Email</div>
            <div>Job Title</div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-100">
            {filtered.map(user => (
              <div key={user.id} className={`grid grid-cols-[48px_1fr_200px] items-center px-3 py-2 ${user.isAuditStaff ? 'bg-green-50/40' : 'bg-white'}`}>
                <div>
                  <button onClick={() => toggleAudit(user)} disabled={toggling.has(user.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      user.isAuditStaff ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300 hover:border-green-400'
                    }`}>
                    {toggling.has(user.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : user.isAuditStaff ? <Check className="h-3 w-3" /> : null}
                  </button>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{user.name}</div>
                  <div className="text-xs text-slate-400 truncate">{user.email}</div>
                </div>
                <div className="text-xs text-slate-500 truncate">{user.jobTitle || '—'}</div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-400">No users found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
