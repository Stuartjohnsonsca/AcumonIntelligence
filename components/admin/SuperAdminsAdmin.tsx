'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, ShieldOff, Search } from 'lucide-react';

interface UserRow {
  id: string;
  name: string;
  email: string;
  displayId: string;
  firmId: string;
  firmName: string;
  isSuperAdmin: boolean;
  isFirmAdmin: boolean;
  isMethodologyAdmin: boolean;
  isActive: boolean;
  jobTitle: string | null;
}

export function SuperAdminsAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleSuperAdmin(userId: string, promote: boolean) {
    setUpdating(userId);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isSuperAdmin: promote }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === userId ? data.user : u)));
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update');
      }
    } finally {
      setUpdating(null);
    }
  }

  const superAdmins = users.filter((u) => u.isSuperAdmin);
  const otherUsers = users.filter((u) => !u.isSuperAdmin && u.isActive);
  const filteredOthers = search.trim()
    ? otherUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          u.firmName.toLowerCase().includes(search.toLowerCase())
      )
    : otherUsers;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Current Super Admins */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Current Super Admins</h3>
        <p className="text-sm text-slate-500 mb-4">
          Super Admins have full access across all firms. They can manage Test Actions, promote other users, and configure global settings.
        </p>

        {superAdmins.length === 0 ? (
          <div className="text-center py-8 border rounded-lg bg-slate-50">
            <Shield className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No Super Admins configured</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Email</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Firm</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Role</th>
                  <th className="w-32 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {superAdmins.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center">
                          <span className="text-[10px] font-bold text-purple-700">
                            {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-slate-800">{u.name}</span>
                          <span className="text-xs text-slate-400 ml-1.5">{u.displayId}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.firmName}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        <Shield className="h-3 w-3" /> Super Admin
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleSuperAdmin(u.id, false)}
                        disabled={updating === u.id}
                        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      >
                        {updating === u.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <ShieldOff className="h-3.5 w-3.5 mr-1" />
                        )}
                        Demote
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Promote a user */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Promote a User</h3>
        <p className="text-sm text-slate-500 mb-4">
          Search for any user across all firms and promote them to Super Admin. This also grants Firm Admin and Methodology Admin.
        </p>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or firm..."
            className="w-full border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {search.trim() && filteredOthers.length === 0 && (
          <div className="text-center py-6 text-sm text-slate-400">No matching users found</div>
        )}

        {(search.trim() ? filteredOthers : filteredOthers.slice(0, 10)).length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Email</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Firm</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Title</th>
                  <th className="w-32 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {(search.trim() ? filteredOthers : filteredOthers.slice(0, 10)).map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-[10px] font-bold text-blue-700">
                            {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-slate-800">{u.name}</span>
                          <span className="text-xs text-slate-400 ml-1.5">{u.displayId}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.firmName}</td>
                    <td className="px-4 py-3 text-slate-500">{u.jobTitle || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        onClick={() => toggleSuperAdmin(u.id, true)}
                        disabled={updating === u.id}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        {updating === u.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Shield className="h-3.5 w-3.5 mr-1" />
                        )}
                        Promote
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!search.trim() && filteredOthers.length > 10 && (
              <div className="text-center py-2 text-xs text-slate-400 bg-slate-50 border-t">
                Showing first 10 of {filteredOthers.length} users — search to find others
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
