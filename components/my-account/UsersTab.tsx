'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Loader2, RefreshCw, CheckCircle, AlertCircle, MinusCircle, Users } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface User {
  id: string;
  displayId: string;
  name: string;
  email: string;
  isFirmAdmin: boolean;
  isPortfolioOwner: boolean;
  isActive: boolean;
  expiryDate: string | null;
  jobTitle?: string | null;
  department?: string | null;
  lastSyncedAt?: string | null;
}

interface SyncAction {
  action: 'create' | 'update' | 'deactivate' | 'unchanged';
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  changes?: Record<string, { from: string | null; to: string | null }>;
}

interface SyncPreview {
  preview: boolean;
  summary: { create: number; update: number; deactivate: number; unchanged: number };
  actions: SyncAction[];
}

interface Props {
  firmId: string;
  isSuperAdmin: boolean;
  currentUserId: string;
}

export function UsersTab({ firmId, isSuperAdmin, currentUserId }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', displayId: '', password: '',
    isFirmAdmin: false, isPortfolioOwner: false,
  });

  // AD Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; deactivated: number } | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  async function loadUsers() {
    setLoading(true);
    const res = await fetch(`/api/users?firmId=${firmId}`);
    const data = await res.json();
    setUsers(data);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, [firmId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, firmId }),
    });
    setForm({ name: '', email: '', displayId: '', password: '', isFirmAdmin: false, isPortfolioOwner: false });
    setShowForm(false);
    await loadUsers();
    setSaving(false);
  }

  async function handleDelete(userId: string) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    await loadUsers();
  }

  // AD Sync functions
  async function handleSyncPreview() {
    setSyncing(true);
    setSyncError(null);
    setSyncPreview(null);
    setSyncResult(null);

    try {
      const res = await fetch('/api/users/sync-ad');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: SyncPreview = await res.json();
      setSyncPreview(data);
    } catch (err: any) {
      setSyncError(err.message || 'Failed to fetch AD users');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncExecute() {
    setSyncing(true);
    setSyncError(null);

    try {
      const res = await fetch('/api/users/sync-ad', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSyncResult(data.results);
      setSyncPreview(null);
      await loadUsers();
    } catch (err: any) {
      setSyncError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const lastSync = users.find(u => u.lastSyncedAt)?.lastSyncedAt;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Users</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleSyncPreview} disabled={syncing} size="sm" className="bg-blue-600 hover:bg-blue-700">
            {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sync from Azure AD
          </Button>
          <Button onClick={() => setShowForm(!showForm)} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />Add User
          </Button>
        </div>
      </div>

      {/* Last sync info */}
      {lastSync && (
        <div className="text-xs text-slate-400">
          Last synced: {new Date(lastSync).toLocaleString('en-GB')}
        </div>
      )}

      {/* Sync error */}
      {syncError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>Sync Error:</strong> {syncError}
            {syncError.includes('token') && (
              <p className="mt-1 text-xs">Ensure the Azure app has <code>User.Read.All</code> application permission with admin consent.</p>
            )}
          </div>
          <button onClick={() => setSyncError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Sync success */}
      {syncResult && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          Sync complete: {syncResult.created} created, {syncResult.updated} updated, {syncResult.deactivated} deactivated
          <button onClick={() => setSyncResult(null)} className="ml-auto text-green-400 hover:text-green-600">×</button>
        </div>
      )}

      {/* Sync preview modal */}
      {syncPreview && (
        <Card className="border-blue-200 bg-blue-50/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                Azure AD Sync Preview
              </CardTitle>
              <button onClick={() => setSyncPreview(null)} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
            </div>
            <div className="flex gap-4 text-xs mt-2">
              <span className="flex items-center gap-1 text-green-700">
                <span className="w-2 h-2 rounded-full bg-green-500" /> {syncPreview.summary.create} new
              </span>
              <span className="flex items-center gap-1 text-amber-700">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> {syncPreview.summary.update} to update
              </span>
              <span className="flex items-center gap-1 text-red-700">
                <span className="w-2 h-2 rounded-full bg-red-500" /> {syncPreview.summary.deactivate} to deactivate
              </span>
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-2 h-2 rounded-full bg-slate-300" /> {syncPreview.summary.unchanged} unchanged
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {/* Create */}
              {syncPreview.actions.filter(a => a.action === 'create').map((a, i) => (
                <div key={`c-${i}`} className="flex items-center gap-3 px-3 py-2 bg-green-50 border border-green-100 rounded text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="font-medium text-green-800">{a.name}</span>
                  <span className="text-green-600 text-xs">{a.email}</span>
                  {a.jobTitle && <span className="text-green-500 text-xs">• {a.jobTitle}</span>}
                  {a.department && <span className="text-green-500 text-xs">• {a.department}</span>}
                  <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">New</span>
                </div>
              ))}

              {/* Update */}
              {syncPreview.actions.filter(a => a.action === 'update').map((a, i) => (
                <div key={`u-${i}`} className="flex items-center gap-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded text-sm">
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="font-medium text-amber-800">{a.name}</span>
                  <span className="text-amber-600 text-xs">{a.email}</span>
                  <div className="ml-auto flex gap-1">
                    {a.changes && Object.entries(a.changes).map(([field, val]) => (
                      <span key={field} className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        {field}: {val.from || '—'} → {val.to || '—'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {/* Deactivate */}
              {syncPreview.actions.filter(a => a.action === 'deactivate').map((a, i) => (
                <div key={`d-${i}`} className="flex items-center gap-3 px-3 py-2 bg-red-50 border border-red-100 rounded text-sm">
                  <MinusCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                  <span className="font-medium text-red-800">{a.name}</span>
                  <span className="text-red-600 text-xs">{a.email}</span>
                  <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Deactivate</span>
                </div>
              ))}

              {/* Unchanged (collapsed) */}
              {syncPreview.summary.unchanged > 0 && (
                <button onClick={() => setShowUnchanged(!showUnchanged)}
                  className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded">
                  {showUnchanged ? '▾' : '▸'} {syncPreview.summary.unchanged} unchanged users
                </button>
              )}
              {showUnchanged && syncPreview.actions.filter(a => a.action === 'unchanged').map((a, i) => (
                <div key={`n-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0" />
                  <span>{a.name}</span>
                  <span className="text-xs">{a.email}</span>
                </div>
              ))}
            </div>

            {/* Confirm/Cancel */}
            <div className="flex gap-2 mt-4 pt-3 border-t border-blue-100">
              <Button onClick={handleSyncExecute} disabled={syncing} className="bg-blue-600 hover:bg-blue-700">
                {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                Confirm Sync
              </Button>
              <Button variant="outline" onClick={() => setSyncPreview(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual add form */}
      {showForm && (
        <Card className="border-slate-200">
          <CardHeader><CardTitle className="text-base">New User (Manual)</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>User ID</Label>
                <Input value={form.displayId} onChange={e => setForm({ ...form, displayId: e.target.value })} required placeholder="e.g. JB002" />
              </div>
              <div className="space-y-1.5">
                <Label>Initial Password (min 8 chars)</Label>
                <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={8} />
              </div>
              <div className="sm:col-span-2 flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isFirmAdmin} onChange={e => setForm({ ...form, isFirmAdmin: e.target.checked })} className="rounded" />
                  <span className="text-sm">Firm Administrator</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isPortfolioOwner} onChange={e => setForm({ ...form, isPortfolioOwner: e.target.checked })} className="rounded" />
                  <span className="text-sm">Portfolio Owner</span>
                </label>
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create User'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* User list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className={`flex items-center justify-between p-4 bg-white border rounded-lg hover:border-slate-300 transition-colors ${u.isActive ? 'border-slate-200' : 'border-red-200 bg-red-50/30 opacity-60'}`}>
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-sm font-semibold text-blue-700">
                    {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </span>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-slate-800">{u.name}</span>
                    {u.isFirmAdmin && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Firm Admin</span>}
                    {u.isPortfolioOwner && !u.isFirmAdmin && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Portfolio Owner</span>}
                    {!u.isActive && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <div className="text-sm text-slate-500">
                    {u.email} · {u.displayId}
                    {u.jobTitle && <span className="ml-1 text-slate-400">· {u.jobTitle}</span>}
                    {u.department && <span className="ml-1 text-slate-400">· {u.department}</span>}
                  </div>
                  {u.expiryDate && <div className="text-xs text-slate-400">Expires: {formatDate(u.expiryDate)}</div>}
                </div>
              </div>
              {u.id !== currentUserId && (
                <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {users.length === 0 && (
            <div className="text-center py-12 text-slate-500">No users found. Sync from Azure AD or add manually above.</div>
          )}
        </div>
      )}
    </div>
  );
}
