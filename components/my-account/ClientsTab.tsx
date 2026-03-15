'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Plus, Upload, Pencil, X, Check, Loader2, Users, Search,
  ChevronUp, ChevronDown, UserPlus, UserMinus, FileText, AlertCircle
} from 'lucide-react';

interface AssignedUser {
  id: string;
  name: string;
  displayId: string;
  email: string;
}

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
  contactEmail: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { subscriptions: number; userAssignments: number };
  userAssignments: { user: AssignedUser }[];
}

interface FirmUser {
  id: string;
  name: string;
  displayId: string;
  email: string;
}

type SortKey = 'clientName' | 'software' | 'contactName' | 'contactEmail' | 'isActive';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'add-manual' | 'add-csv' | 'assign';

const EMPTY_FORM = { clientName: '', software: '', contactName: '', contactEmail: '' };

interface Props {
  firmId: string;
  isPortfolioOwner: boolean;
  isFirmAdmin: boolean;
  isSuperAdmin: boolean;
}

export function ClientsTab({ firmId, isPortfolioOwner, isFirmAdmin, isSuperAdmin }: Props) {
  const canManage = isSuperAdmin || isFirmAdmin || isPortfolioOwner;

  const [clients, setClients] = useState<Client[]>([]);
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Filters / sort
  const [search, setSearch] = useState<Record<SortKey, string>>({
    clientName: '', software: '', contactName: '', contactEmail: '', isActive: '',
  });
  const [sortKey, setSortKey] = useState<SortKey>('clientName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showInactive, setShowInactive] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Add manual
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // CSV
  const [csvRows, setCsvRows] = useState<typeof EMPTY_FORM[]>([]);
  const [csvError, setCsvError] = useState('');
  const [csvSaving, setCsvSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Assign users
  const [assignClientId, setAssignClientId] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);

  const loadClients = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/clients?firmId=${firmId}&includeInactive=true`);
    const data = await res.json();
    setClients(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [firmId]);

  const loadFirmUsers = useCallback(async () => {
    const res = await fetch(`/api/users?firmId=${firmId}`);
    const data = await res.json();
    setFirmUsers(Array.isArray(data) ? data : []);
  }, [firmId]);

  useEffect(() => {
    loadClients();
    loadFirmUsers();
  }, [loadClients, loadFirmUsers]);

  // ── Sort & filter ──────────────────────────────────────────────────────────
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filteredClients = clients
    .filter((c) => (showInactive ? true : c.isActive))
    .filter((c) => {
      const s = search;
      if (s.clientName && !c.clientName.toLowerCase().includes(s.clientName.toLowerCase())) return false;
      if (s.software && !(c.software || '').toLowerCase().includes(s.software.toLowerCase())) return false;
      if (s.contactName && !(c.contactName || '').toLowerCase().includes(s.contactName.toLowerCase())) return false;
      if (s.contactEmail && !(c.contactEmail || '').toLowerCase().includes(s.contactEmail.toLowerCase())) return false;
      if (s.isActive) {
        const activeStr = c.isActive ? 'active' : 'inactive';
        if (!activeStr.includes(s.isActive.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let av: string = '', bv: string = '';
      if (sortKey === 'isActive') { av = a.isActive ? 'a' : 'b'; bv = b.isActive ? 'a' : 'b'; }
      else { av = (a[sortKey] || '').toLowerCase(); bv = (b[sortKey] || '').toLowerCase(); }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  // ── Inline edit ────────────────────────────────────────────────────────────
  function startEdit(c: Client) {
    setEditingId(c.id);
    setEditForm({ clientName: c.clientName, software: c.software || '', contactName: c.contactName || '', contactEmail: c.contactEmail || '' });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditingId(null);
    await loadClients();
    setSaving(false);
  }

  async function toggleActive(c: Client) {
    await fetch(`/api/clients/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    await loadClients();
  }

  // ── Add manual ─────────────────────────────────────────────────────────────
  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    setAddSaving(true);
    await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...addForm, firmId }),
    });
    setAddForm(EMPTY_FORM);
    setViewMode('list');
    await loadClients();
    setAddSaving(false);
  }

  // ── CSV upload ─────────────────────────────────────────────────────────────
  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { setCsvError('CSV must have a header row and at least one data row.'); return; }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
      const nameIdx = headers.findIndex((h) => h.includes('client') || h === 'name');
      if (nameIdx === -1) { setCsvError('CSV must have a column named "Client Name" or "Name".'); return; }

      const softwareIdx = headers.findIndex((h) => h.includes('software'));
      const contactNameIdx = headers.findIndex((h) => h.includes('contactname') || h.includes('contact_name'));
      const contactEmailIdx = headers.findIndex((h) => h.includes('contactemail') || h.includes('contact_email') || h.includes('email'));

      const rows = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        return {
          clientName: cols[nameIdx] || '',
          software: softwareIdx >= 0 ? cols[softwareIdx] || '' : '',
          contactName: contactNameIdx >= 0 ? cols[contactNameIdx] || '' : '',
          contactEmail: contactEmailIdx >= 0 ? cols[contactEmailIdx] || '' : '',
        };
      }).filter((r) => r.clientName);

      if (rows.length === 0) { setCsvError('No valid rows found in CSV.'); return; }
      setCsvRows(rows);
    };
    reader.readAsText(file);
  }

  async function handleCsvImport() {
    if (!csvRows.length) return;
    setCsvSaving(true);
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients: csvRows, firmId }),
    });
    const data = await res.json();
    setCsvRows([]);
    if (fileRef.current) fileRef.current.value = '';
    setViewMode('list');
    await loadClients();
    setCsvSaving(false);
    if (data.created) alert(`Successfully imported ${data.created} clients.`);
  }

  // ── Assign users ───────────────────────────────────────────────────────────
  const assignClient = clients.find((c) => c.id === assignClientId);
  const assignedUserIds = new Set(assignClient?.userAssignments.map((a) => a.user.id) || []);

  async function toggleAssignment(userId: string) {
    if (!assignClientId) return;
    setAssignLoading(true);
    const isAssigned = assignedUserIds.has(userId);
    await fetch(`/api/clients/${assignClientId}/assignments`, {
      method: isAssigned ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    await loadClients();
    setAssignLoading(false);
  }

  // ── Header cell ─────────────────────────────────────────────────────────────
  function SortableHeader({ k, label }: { k: SortKey; label: string }) {
    return (
      <th className="px-3 py-2 text-left">
        <div className="space-y-1">
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
          <Input
            value={search[k]}
            onChange={(e) => setSearch((s) => ({ ...s, [k]: e.target.value }))}
            placeholder="Search..."
            className="h-6 text-xs px-2 py-0"
          />
        </div>
      </th>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-800">Clients</h2>
          <Badge variant="secondary">{filteredClients.length}</Badge>
        </div>
        {canManage && viewMode === 'list' && (
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm" variant="outline"
              onClick={() => setShowInactive((v) => !v)}
              className={showInactive ? 'border-orange-300 text-orange-700 bg-orange-50' : ''}
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setViewMode('assign'); setAssignClientId(null); }}>
              <UserPlus className="h-4 w-4 mr-1" />Assign Users
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCsvRows([]); setCsvError(''); setViewMode('add-csv'); }}>
              <Upload className="h-4 w-4 mr-1" />Upload CSV
            </Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { setAddForm(EMPTY_FORM); setViewMode('add-manual'); }}>
              <Plus className="h-4 w-4 mr-1" />Add Client
            </Button>
          </div>
        )}
        {viewMode !== 'list' && (
          <Button size="sm" variant="outline" onClick={() => setViewMode('list')}>
            <X className="h-4 w-4 mr-1" />Back to List
          </Button>
        )}
      </div>

      {/* ── Add manual ── */}
      {viewMode === 'add-manual' && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="text-base">Add Client Manually</CardTitle>
            <CardDescription>Client will be associated with your firm automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddManual} className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Client Name <span className="text-red-500">*</span></Label>
                <Input value={addForm.clientName} onChange={(e) => setAddForm({ ...addForm, clientName: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Software</Label>
                <Input value={addForm.software} onChange={(e) => setAddForm({ ...addForm, software: e.target.value })} placeholder="e.g. Xero, Sage, QuickBooks" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input value={addForm.contactName} onChange={(e) => setAddForm({ ...addForm, contactName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input type="email" value={addForm.contactEmail} onChange={(e) => setAddForm({ ...addForm, contactEmail: e.target.value })} />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={addSaving} className="bg-blue-600 hover:bg-blue-700">
                  {addSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                  Add Client
                </Button>
                <Button type="button" variant="outline" onClick={() => setViewMode('list')}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── CSV upload ── */}
      {viewMode === 'add-csv' && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="text-base">Upload CSV</CardTitle>
            <CardDescription>
              CSV must have a header row. Required column: <code className="bg-slate-100 px-1 rounded text-xs">Client Name</code>.
              Optional: <code className="bg-slate-100 px-1 rounded text-xs">Software</code>,{' '}
              <code className="bg-slate-100 px-1 rounded text-xs">Contact Name</code>,{' '}
              <code className="bg-slate-100 px-1 rounded text-xs">Contact Email</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input ref={fileRef} type="file" accept=".csv" onChange={handleCsvFile} className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />

            {csvError && (
              <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />{csvError}
              </div>
            )}

            {csvRows.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700"><FileText className="inline h-4 w-4 mr-1" />{csvRows.length} rows ready to import</p>
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Client Name</th>
                        <th className="text-left px-3 py-2 font-medium">Software</th>
                        <th className="text-left px-3 py-2 font-medium">Contact Name</th>
                        <th className="text-left px-3 py-2 font-medium">Contact Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">{r.clientName}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.software}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.contactName}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.contactEmail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCsvImport} disabled={csvSaving} className="bg-blue-600 hover:bg-blue-700">
                    {csvSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                    Import {csvRows.length} Clients
                  </Button>
                  <Button variant="outline" onClick={() => { setCsvRows([]); if (fileRef.current) fileRef.current.value = ''; }}>Clear</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Assign users to clients ── */}
      {viewMode === 'assign' && (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base">Assign Users to Clients</CardTitle>
            <CardDescription>Select a client, then toggle users on or off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Select Client</Label>
              <select
                value={assignClientId || ''}
                onChange={(e) => setAssignClientId(e.target.value || null)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— choose a client —</option>
                {clients.filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>{c.clientName}</option>
                ))}
              </select>
            </div>

            {assignClientId && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Firm Users</p>
                {firmUsers.length === 0 && (
                  <p className="text-sm text-slate-400">No users found for this firm.</p>
                )}
                <div className="divide-y border rounded-lg">
                  {firmUsers.map((u) => {
                    const assigned = assignedUserIds.has(u.id);
                    return (
                      <div key={u.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <span className="font-medium text-slate-800 text-sm">{u.name}</span>
                          <span className="ml-2 text-xs text-slate-400">{u.displayId}</span>
                          <div className="text-xs text-slate-400">{u.email}</div>
                        </div>
                        <Button
                          size="sm"
                          variant={assigned ? 'destructive' : 'outline'}
                          onClick={() => toggleAssignment(u.id)}
                          disabled={assignLoading}
                          className={assigned ? '' : 'border-green-300 text-green-700 hover:bg-green-50'}
                        >
                          {assignLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : assigned ? (
                            <><UserMinus className="h-3 w-3 mr-1" />Remove</>
                          ) : (
                            <><UserPlus className="h-3 w-3 mr-1" />Assign</>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Client table ── */}
      {viewMode === 'list' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Users className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              {clients.length === 0 ? 'No clients yet. Add your first client above.' : 'No clients match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <SortableHeader k="clientName" label="Client Name" />
                    <SortableHeader k="software" label="Software" />
                    <SortableHeader k="contactName" label="Contact Name" />
                    <SortableHeader k="contactEmail" label="Contact Email" />
                    <SortableHeader k="isActive" label="Status" />
                    <th className="px-3 py-2 text-left">
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Assigned Users</span>
                    </th>
                    {canManage && <th className="px-3 py-2 w-20"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredClients.map((c) => (
                    <tr key={c.id} className={`hover:bg-slate-50 transition-colors ${!c.isActive ? 'opacity-60' : ''}`}>
                      {editingId === c.id ? (
                        <>
                          <td className="px-3 py-2">
                            <Input value={editForm.clientName} onChange={(e) => setEditForm({ ...editForm, clientName: e.target.value })} className="h-8 text-sm" />
                          </td>
                          <td className="px-3 py-2">
                            <Input value={editForm.software} onChange={(e) => setEditForm({ ...editForm, software: e.target.value })} className="h-8 text-sm" placeholder="e.g. Xero" />
                          </td>
                          <td className="px-3 py-2">
                            <Input value={editForm.contactName} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} className="h-8 text-sm" />
                          </td>
                          <td className="px-3 py-2">
                            <Input value={editForm.contactEmail} onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })} className="h-8 text-sm" />
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={c.isActive ? 'default' : 'secondary'} className={c.isActive ? 'bg-green-100 text-green-700 hover:bg-green-100' : ''}>
                              {c.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400">{c._count.userAssignments} users</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => saveEdit(c.id)} disabled={saving}>
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-slate-600" onClick={() => setEditingId(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-3 font-medium text-slate-800">{c.clientName}</td>
                          <td className="px-3 py-3 text-slate-500">{c.software || '—'}</td>
                          <td className="px-3 py-3 text-slate-500">{c.contactName || '—'}</td>
                          <td className="px-3 py-3 text-slate-500">{c.contactEmail || '—'}</td>
                          <td className="px-3 py-3">
                            <button onClick={() => canManage && toggleActive(c)} title={canManage ? 'Click to toggle status' : undefined}>
                              <Badge
                                variant={c.isActive ? 'default' : 'secondary'}
                                className={`${c.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'} ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                {c.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {c.userAssignments.slice(0, 3).map((a) => (
                                <span key={a.user.id} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{a.user.name}</span>
                              ))}
                              {c.userAssignments.length > 3 && (
                                <span className="text-xs text-slate-400">+{c.userAssignments.length - 3} more</span>
                              )}
                              {c.userAssignments.length === 0 && (
                                <span className="text-xs text-slate-300">None</span>
                              )}
                            </div>
                          </td>
                          {canManage && (
                            <td className="px-3 py-3">
                              <div className="flex gap-1">
                                <Button
                                  size="icon" variant="ghost"
                                  className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                  title="Edit client"
                                  onClick={() => startEdit(c)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon" variant="ghost"
                                  className={`h-7 w-7 ${c.isActive ? 'text-slate-400 hover:text-orange-600 hover:bg-orange-50' : 'text-slate-400 hover:text-green-600 hover:bg-green-50'}`}
                                  title={c.isActive ? 'Set inactive' : 'Set active'}
                                  onClick={() => toggleActive(c)}
                                >
                                  {c.isActive ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                                </Button>
                              </div>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
