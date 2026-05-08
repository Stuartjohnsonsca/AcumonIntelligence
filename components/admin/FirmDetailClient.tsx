'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Building2, Loader2, Shield, UserCog, Settings2, Briefcase } from 'lucide-react';

interface UserRow {
  id: string;
  displayId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  isSuperAdmin: boolean;
  isFirmAdmin: boolean;
  isMethodologyAdmin: boolean;
  isResourceAdmin: boolean;
  isActive: boolean;
}

interface Firm {
  id: string;
  name: string;
  dataRegion: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  registeredCompanyNumber: string | null;
  statutoryAuditorNumber: string | null;
  counts: { users: number; clients: number; engagements: number };
}

interface Props {
  firm: Firm;
  users: UserRow[];
}

type RoleKey = 'isFirmAdmin' | 'isMethodologyAdmin' | 'isResourceAdmin';

const ROLE_LABELS: Record<RoleKey, string> = {
  isFirmAdmin: 'Firm Admin',
  isMethodologyAdmin: 'Methodology Admin',
  isResourceAdmin: 'Resource Admin',
};

export function FirmDetailClient({ firm, users: initialUsers }: Props) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleRole(userId: string, key: RoleKey, value: boolean) {
    setUpdating(`${userId}:${key}`);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, [key]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...data.user } : u)));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to update');
      }
    } finally {
      setUpdating(null);
    }
  }

  const activeUsers = users.filter((u) => u.isActive);
  const methodologyAdmins = activeUsers.filter((u) => u.isMethodologyAdmin);
  const firmAdmins = activeUsers.filter((u) => u.isFirmAdmin);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/my-account/admin"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Administration
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <Building2 className="h-5 w-5 text-slate-500" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{firm.name}</h1>
              <p className="text-slate-600">Firm details · Data region: {firm.dataRegion.toUpperCase()}</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Users</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{firm.counts.users}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Clients</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{firm.counts.clients}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Audit Engagements</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{firm.counts.engagements}</div>
          </CardContent>
        </Card>
      </div>

      {/* Firm info */}
      <Card>
        <CardContent className="p-5 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <InfoRow label="Email" value={firm.email} />
            <InfoRow label="Phone" value={firm.phone} />
            <InfoRow label="Website" value={firm.website} />
            <InfoRow label="Company Number" value={firm.registeredCompanyNumber} />
            <InfoRow label="Statutory Auditor No." value={firm.statutoryAuditorNumber} />
            <InfoRow label="Address" value={firm.address} />
          </div>
        </CardContent>
      </Card>

      {/* Role summary */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Role Assignments</h2>
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <UserCog className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-slate-800">Firm Admins</span>
                <span className="text-xs text-slate-500 ml-auto">{firmAdmins.length}</span>
              </div>
              {firmAdmins.length === 0 ? (
                <p className="text-xs text-slate-400 italic">None assigned</p>
              ) : (
                <ul className="text-xs text-slate-600 space-y-0.5">
                  {firmAdmins.map((u) => (
                    <li key={u.id}>{u.name}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings2 className="h-4 w-4 text-emerald-600" />
                <span className="font-medium text-slate-800">Methodology Admins</span>
                <span className="text-xs text-slate-500 ml-auto">{methodologyAdmins.length}</span>
              </div>
              {methodologyAdmins.length === 0 ? (
                <p className="text-xs text-slate-400 italic">None assigned</p>
              ) : (
                <ul className="text-xs text-slate-600 space-y-0.5">
                  {methodologyAdmins.map((u) => (
                    <li key={u.id}>{u.name}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Users + role management */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Users</h2>
        <p className="text-sm text-slate-500 mb-4">
          Grant Firm Admin, Methodology Admin, or Resource Admin per user. These roles are scoped to this firm only.
          Super Admin status can only be changed from the Super Admins tab.
        </p>

        {users.length === 0 ? (
          <div className="text-center py-10 text-sm text-slate-400 border rounded-lg">No users in this firm yet.</div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">User</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Email</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600 w-32">Firm Admin</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600 w-40">Methodology Admin</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600 w-36">Resource Admin</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-slate-50 ${u.isActive ? 'hover:bg-slate-50/50' : 'opacity-60'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-[10px] font-bold text-blue-700">
                            {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-slate-800">{u.name}</span>
                          <span className="text-xs text-slate-400 ml-1.5">{u.displayId}</span>
                          {u.isSuperAdmin && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                              <Shield className="h-2.5 w-2.5" /> SA
                            </span>
                          )}
                          {u.jobTitle && <div className="text-xs text-slate-400">{u.jobTitle}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                    <RoleCell
                      checked={u.isFirmAdmin}
                      disabled={u.isSuperAdmin || updating === `${u.id}:isFirmAdmin`}
                      loading={updating === `${u.id}:isFirmAdmin`}
                      title={u.isSuperAdmin ? 'Super Admin always has Firm Admin rights' : undefined}
                      onChange={(v) => toggleRole(u.id, 'isFirmAdmin', v)}
                    />
                    <RoleCell
                      checked={u.isMethodologyAdmin}
                      disabled={u.isSuperAdmin || updating === `${u.id}:isMethodologyAdmin`}
                      loading={updating === `${u.id}:isMethodologyAdmin`}
                      title={u.isSuperAdmin ? 'Super Admin always has Methodology Admin rights' : undefined}
                      onChange={(v) => toggleRole(u.id, 'isMethodologyAdmin', v)}
                    />
                    <RoleCell
                      checked={u.isResourceAdmin}
                      disabled={updating === `${u.id}:isResourceAdmin`}
                      loading={updating === `${u.id}:isResourceAdmin`}
                      onChange={(v) => toggleRole(u.id, 'isResourceAdmin', v)}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
      <div className="text-slate-800">{value || <span className="text-slate-400 italic">—</span>}</div>
    </div>
  );
}

function RoleCell({
  checked,
  disabled,
  loading,
  title,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <td className="px-3 py-2.5 text-center">
      <label className="inline-flex items-center justify-center cursor-pointer" title={title}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        ) : (
          <input
            type="checkbox"
            className="h-4 w-4 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
        )}
      </label>
    </td>
  );
}
