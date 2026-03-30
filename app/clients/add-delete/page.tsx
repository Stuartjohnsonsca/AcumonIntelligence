'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Pencil, Plus, Archive, RotateCcw, Loader2, X, Search,
  ChevronUp, ChevronDown, ArrowLeft,
} from 'lucide-react';

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactFirstName: string | null;
  contactSurname: string | null;
  contactEmail: string | null;
  portfolioManagerId: string | null;
  isActive: boolean;
  readOnly: boolean;
  createdAt: string;
  portfolioManager?: { id: string; name: string; email: string } | null;
}

interface FirmUser {
  id: string;
  name: string;
  email: string;
  isPortfolioOwner?: boolean;
}

type ViewMode = 'list' | 'create' | 'edit' | 'archived';
type SortKey = 'clientName' | 'software' | 'contactFirstName' | 'contactEmail';
type SortDir = 'asc' | 'desc';

const EMPTY_FORM = { clientName: '', software: '', contactFirstName: '', contactSurname: '', contactEmail: '', portfolioManagerId: '' };

export default function AddDeletePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('clientName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const firmId = (session?.user as { firmId?: string })?.firmId;

  const loadClients = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    const res = await fetch(`/api/clients?firmId=${firmId}&includeInactive=true`);
    const data = await res.json();
    setClients(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [firmId]);

  const loadFirmUsers = useCallback(async () => {
    if (!firmId) return;
    const res = await fetch(`/api/users?firmId=${firmId}`);
    const data = await res.json();
    setFirmUsers(Array.isArray(data) ? data : []);
  }, [firmId]);

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (firmId) { loadClients(); loadFirmUsers(); }
  }, [status, firmId, router, loadClients, loadFirmUsers]);

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const activeClients = clients.filter((c) => c.isActive);
  const archivedClients = clients.filter((c) => !c.isActive);
  const displayClients = viewMode === 'archived' ? archivedClients : activeClients;

  const filtered = displayClients
    .filter((c) => {
      if (!search) return true;
      const term = search.toLowerCase();
      return (
        c.clientName.toLowerCase().includes(term) ||
        (c.software || '').toLowerCase().includes(term) ||
        (c.contactFirstName || '').toLowerCase().includes(term) ||
        (c.contactSurname || '').toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      const av = (a[sortKey] || '').toLowerCase();
      const bv = (b[sortKey] || '').toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function handleCheckbox(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: form.clientName,
        software: form.software || null,
        contactFirstName: form.contactFirstName || null,
        contactSurname: form.contactSurname || null,
        contactEmail: form.contactEmail || null,
        portfolioManagerId: form.portfolioManagerId || null,
        firmId,
      }),
    });
    setForm(EMPTY_FORM);
    setViewMode('list');
    await loadClients();
    setSaving(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    await fetch(`/api/clients/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: form.clientName,
        software: form.software || null,
        contactFirstName: form.contactFirstName || null,
        contactSurname: form.contactSurname || null,
        contactEmail: form.contactEmail || null,
        portfolioManagerId: form.portfolioManagerId || null,
      }),
    });
    setEditingId(null);
    setForm(EMPTY_FORM);
    setViewMode('list');
    await loadClients();
    setSaving(false);
  }

  function startAmend() {
    if (selectedIds.size !== 1) return;
    const clientId = [...selectedIds][0];
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setEditingId(clientId);
    setForm({
      clientName: client.clientName,
      software: client.software || '',
      contactFirstName: client.contactFirstName || '',
      contactSurname: client.contactSurname || '',
      contactEmail: client.contactEmail || '',
      portfolioManagerId: client.portfolioManagerId || '',
    });
    setViewMode('edit');
  }

  async function handleRemove() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Archive ${selectedIds.size} client${selectedIds.size > 1 ? 's' : ''}? They can be retrieved later.`)) return;
    setArchiving(true);
    for (const id of selectedIds) {
      await fetch(`/api/clients/${id}/archive`, { method: 'POST' });
    }
    setSelectedIds(new Set());
    await loadClients();
    setArchiving(false);
  }

  async function handleRestore(readOnly: boolean) {
    if (selectedIds.size === 0) return;
    setRestoring(true);
    for (const id of selectedIds) {
      await fetch(`/api/clients/${id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readOnly }),
      });
    }
    setSelectedIds(new Set());
    await loadClients();
    setRestoring(false);
    setViewMode('list');
  }

  const portfolioOwners = firmUsers.filter((u) => u.isPortfolioOwner);

  function SortHeader({ k, label }: { k: SortKey; label: string }) {
    return (
      <th className="px-3 py-2 text-left">
        <button
          onClick={() => toggleSort(k)}
          className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase tracking-wide hover:text-slate-900"
        >
          {label}
          {sortKey === k ? (
            sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3 opacity-20" />
          )}
        </button>
      </th>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Clients — Add / Delete</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your firm&apos;s client list</p>
      </div>

      {/* Action buttons */}
      {(viewMode === 'list' || viewMode === 'archived') && (
        <div className="flex flex-wrap gap-2 mb-4">
          {viewMode === 'list' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={startAmend}
                disabled={selectedIds.size !== 1}
                className="border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Amend
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
                onClick={() => { setForm(EMPTY_FORM); setViewMode('create'); }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create New
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRemove}
                disabled={selectedIds.size === 0 || archiving}
                className="border-red-200 text-red-700 hover:bg-red-50"
              >
                {archiving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1" />}
                Remove
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setSelectedIds(new Set()); setViewMode('archived'); }}
                className="border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Retrieve
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setSelectedIds(new Set()); setViewMode('list'); }}
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Back to Active
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRestore(true)}
                disabled={selectedIds.size === 0 || restoring}
                className="border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                {restoring ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                Retrieve as Read Only
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => handleRestore(false)}
                disabled={selectedIds.size === 0 || restoring}
              >
                {restoring ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                Retrieve
              </Button>
            </>
          )}
        </div>
      )}

      {/* Create / Edit form */}
      {(viewMode === 'create' || viewMode === 'edit') && (
        <Card className="mb-6 border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="text-base">
              {viewMode === 'create' ? 'Create New Client' : 'Amend Client'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={viewMode === 'create' ? handleCreate : handleSaveEdit} className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Client Name <span className="text-red-500">*</span></Label>
                <Input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Accounting System</Label>
                <select
                  value={form.software}
                  onChange={(e) => setForm({ ...form, software: e.target.value })}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— None —</option>
                  <option value="Xero">Xero</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>First Name</Label>
                <Input value={form.contactFirstName} onChange={(e) => setForm({ ...form, contactFirstName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Surname</Label>
                <Input value={form.contactSurname} onChange={(e) => setForm({ ...form, contactSurname: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Portfolio Manager</Label>
                <select
                  value={form.portfolioManagerId}
                  onChange={(e) => setForm({ ...form, portfolioManagerId: e.target.value })}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— None —</option>
                  {portfolioOwners.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                  {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  {viewMode === 'create' ? 'Create Client' : 'Save Changes'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setViewMode('list'); setEditingId(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Client table */}
      {(viewMode === 'list' || viewMode === 'archived') && (
        <div className="space-y-3">
          {viewMode === 'archived' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              Showing archived clients. Select clients and choose a retrieve option above.
            </div>
          )}

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="pl-9 h-9"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
                      onChange={() => {
                        const allSelected = filtered.every((c) => selectedIds.has(c.id));
                        if (allSelected) setSelectedIds(new Set());
                        else setSelectedIds(new Set(filtered.map((c) => c.id)));
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <SortHeader k="clientName" label="Client Name" />
                  <SortHeader k="software" label="Software" />
                  <SortHeader k="contactFirstName" label="Contact" />
                  <SortHeader k="contactEmail" label="Email" />
                  <th className="px-3 py-2 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                      {viewMode === 'archived' ? 'No archived clients' : 'No clients found'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr
                      key={c.id}
                      className={`transition-colors cursor-pointer ${
                        selectedIds.has(c.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => handleCheckbox(c.id)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => handleCheckbox(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-800">
                        {c.clientName}
                        {c.readOnly && (
                          <Badge variant="secondary" className="ml-2 text-[10px] bg-amber-50 text-amber-700">
                            Read Only
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{c.software || '—'}</td>
                      <td className="px-3 py-3 text-slate-500">{`${c.contactFirstName || ''} ${c.contactSurname || ''}`.trim() || '—'}</td>
                      <td className="px-3 py-3 text-slate-500">{c.contactEmail || '—'}</td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={c.isActive ? 'default' : 'secondary'}
                          className={c.isActive ? (c.readOnly ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700') : 'bg-slate-100 text-slate-500'}
                        >
                          {c.isActive ? (c.readOnly ? 'Read Only' : 'Active') : 'Archived'}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-400">
            {filtered.length} client{filtered.length !== 1 ? 's' : ''}
            {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          </p>
        </div>
      )}
    </div>
  );
}
