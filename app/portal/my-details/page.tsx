'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Plus, Trash2, Lock, Users, Building2, Check } from 'lucide-react';

interface ClientInfo {
  id: string;
  clientName: string;
  isClientAdmin: boolean;
}

interface PortalUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isClientAdmin: boolean;
  lastLoginAt: string | null;
}

export default function MyDetailsPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [clients, setClients] = useState<ClientInfo[]>([]);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');

  // Client user management
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientUsers, setClientUsers] = useState<PortalUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/portal/my-details?token=${token}`);
        if (res.ok) {
          const data = await res.json();
          setUserName(data.user.name);
          setUserEmail(data.user.email);
          setClients(data.clients || []);
        }
      } catch {}
      setLoading(false);
    }
    if (token) load();
    else setLoading(false);
  }, [token]);

  // Load users when client selected
  useEffect(() => {
    if (!selectedClientId) return;
    setUsersLoading(true);
    setClientUsers([]);
    fetch(`/api/portal/users?clientId=${selectedClientId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : [])
      .then(data => setClientUsers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  }, [selectedClientId, token]);

  async function handleChangePassword() {
    setPwError('');
    setPwMessage('');
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return; }
    setPwLoading(true);
    try {
      const res = await fetch('/api/portal/my-details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setPwMessage('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed');
    }
    setPwLoading(false);
  }

  async function handleAddUser() {
    if (!addName || !addEmail || !selectedClientId) return;
    setAddingUser(true);
    setUserError('');
    setUserSuccess('');
    try {
      const res = await fetch('/api/portal/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, name: addName, email: addEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setUserSuccess(`Portal access created for ${addEmail}`);
      setAddName('');
      setAddEmail('');
      // Reload users
      const usersRes = await fetch(`/api/portal/users?clientId=${selectedClientId}`);
      if (usersRes.ok) setClientUsers(await usersRes.json());
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Failed');
    }
    setAddingUser(false);
  }

  async function handleRemoveUser(email: string) {
    if (!confirm(`Remove portal access for ${email}?`)) return;
    try {
      const res = await fetch('/api/portal/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, email }),
      });
      if (res.ok) {
        setClientUsers(prev => prev.filter(u => u.email !== email));
      }
    } catch {}
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>;

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const isAdmin = selectedClient?.isClientAdmin ?? false;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">My Details</h1>

      {/* User info */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-lg font-bold text-blue-600">{userName?.[0]?.toUpperCase() || '?'}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{userName}</p>
            <p className="text-xs text-slate-500">{userEmail}</p>
          </div>
        </div>
      </div>

      {/* My Clients */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">My Clients</h2>
        </div>
        {clients.length === 0 ? (
          <p className="text-xs text-slate-400">No clients assigned.</p>
        ) : (
          <div className="space-y-2">
            {clients.map(client => (
              <button
                key={client.id}
                onClick={() => setSelectedClientId(client.id)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors text-left ${
                  selectedClientId === client.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="text-sm font-medium text-slate-700">{client.clientName}</span>
                <div className="flex items-center gap-2">
                  {client.isClientAdmin && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded font-medium">Admin</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User management for selected client (admin only) */}
      {selectedClientId && isAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-purple-600" />
            <h2 className="text-sm font-semibold text-slate-800">Manage Portal Users — {selectedClient?.clientName}</h2>
          </div>

          {usersLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
          ) : (
            <div className="space-y-2 mb-4">
              {clientUsers.map(user => (
                <div key={user.id} className="flex items-center justify-between p-2 rounded border border-slate-100">
                  <div>
                    <span className="text-sm text-slate-700">{user.name}</span>
                    <span className="text-xs text-slate-400 ml-2">{user.email}</span>
                    {!user.isActive && <span className="text-[10px] text-red-500 ml-2">Inactive</span>}
                  </div>
                  <button onClick={() => handleRemoveUser(user.email)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5">
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </div>
              ))}
              {clientUsers.length === 0 && <p className="text-xs text-slate-400">No portal users for this client.</p>}
            </div>
          )}

          {/* Add user */}
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs font-medium text-slate-600 mb-2">Add Portal User</p>
            <div className="flex gap-2">
              <input type="text" value={addName} onChange={e => setAddName(e.target.value)} placeholder="Name" className="flex-1 px-3 py-1.5 text-sm border rounded-lg" />
              <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="Email" className="flex-1 px-3 py-1.5 text-sm border rounded-lg" />
              <button onClick={handleAddUser} disabled={addingUser || !addName || !addEmail} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1">
                {addingUser ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
              </button>
            </div>
            {userError && <p className="text-xs text-red-500 mt-1">{userError}</p>}
            {userSuccess && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" />{userSuccess}</p>}
          </div>
        </div>
      )}

      {/* Change Password */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="h-4 w-4 text-slate-600" />
          <h2 className="text-sm font-semibold text-slate-800">Change Password</h2>
        </div>
        <div className="space-y-3 max-w-sm">
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Current password" className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (min 8 characters)" className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={handleChangePassword} disabled={pwLoading || !currentPassword || !newPassword} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
            {pwLoading ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null} Change Password
          </button>
          {pwError && <p className="text-xs text-red-500">{pwError}</p>}
          {pwMessage && <p className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" />{pwMessage}</p>}
        </div>
      </div>
    </div>
  );
}
