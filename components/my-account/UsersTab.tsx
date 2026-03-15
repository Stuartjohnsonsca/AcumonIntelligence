'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Loader2, UserCheck, Shield } from 'lucide-react';
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Users</h2>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-1" />Add User
        </Button>
      </div>

      {showForm && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader><CardTitle className="text-base">New User</CardTitle></CardHeader>
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
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
                  </div>
                  <div className="text-sm text-slate-500">{u.email} &middot; {u.displayId}</div>
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
            <div className="text-center py-12 text-slate-500">No users found. Add the first user above.</div>
          )}
        </div>
      )}
    </div>
  );
}
