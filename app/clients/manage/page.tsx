'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Search, ChevronUp, ChevronDown, ArrowLeft, Users,
  Pencil, Check, X, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ─── Interfaces ──────────────────────────────────────────────────────────────

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
  _count?: { subscriptions: number; userAssignments: number };
  userAssignments?: { user: { id: string; name: string; displayId: string; email: string } }[];
  accountingConnections?: { system: string; orgName: string | null }[];
}

interface FirmUser {
  id: string;
  displayId: string;
  name: string;
  email: string;
  isFirmAdmin: boolean;
  isPortfolioOwner: boolean;
  isActive: boolean;
}

interface PeriodAssignment {
  id: string;
  productKey: string;
  category: string;
  userId: string;
  user: { id: string; name: string; email: string; displayId: string };
}

interface ClientPeriod {
  id: string;
  startDate: string;
  endDate: string;
  productAssignments: PeriodAssignment[];
}

type SortKey = 'clientName' | 'software' | 'contactFirstName' | 'contactEmail';
type SortDir = 'asc' | 'desc';

// ─── Constants ───────────────────────────────────────────────────────────────

const TOOL_COLUMNS = [
  { key: 'DateExtraction', label: 'Financial Data Extraction', short: 'Data Extract' },
  { key: 'DocSummary', label: 'Document Summary', short: 'Doc Summary' },
  { key: 'PortfolioExtraction', label: 'Portfolio Document Extraction', short: 'Portfolio Extract' },
  { key: 'Sampling', label: 'Sample Calculator', short: 'Sample Calc' },
  { key: 'FSChecker', label: 'Financial Statements Checker', short: 'FS Checker' },
];

const SOFTWARE_OPTIONS = ['', 'Xero', 'QuickBooks'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPeriod(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ManagePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Client list state
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('clientName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // Detail view state
  const [activeTab, setActiveTab] = useState<'overview' | 'access'>('overview');
  const [periods, setPeriods] = useState<ClientPeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [accessPeriodIdx, setAccessPeriodIdx] = useState(0);

  // Inline edit state
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const firmId = (session?.user as { firmId?: string })?.firmId;

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const loadClients = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    const res = await fetch(`/api/clients?firmId=${firmId}`);
    const data = await res.json();
    setClients(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [firmId]);

  const loadPeriods = useCallback(async (clientId: string) => {
    setPeriodsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/periods`);
      const data = await res.json();
      setPeriods(Array.isArray(data) ? data : []);
      setAccessPeriodIdx(0);
    } catch { setPeriods([]); }
    setPeriodsLoading(false);
  }, []);

  const loadFirmUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setFirmUsers(Array.isArray(data) ? data : []);
    } catch { setFirmUsers([]); }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (firmId) loadClients();
  }, [status, firmId, router, loadClients]);

  // Load periods + firm users when a client is selected
  useEffect(() => {
    if (selectedClient) {
      loadPeriods(selectedClient.id);
      loadFirmUsers();
    }
  }, [selectedClient, loadPeriods, loadFirmUsers]);

  // ─── Sort & filter ─────────────────────────────────────────────────────────

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = clients
    .filter((c) => c.isActive)
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

  function handleSelect() {
    if (!selectedId) return;
    const client = clients.find((c) => c.id === selectedId);
    if (client) setSelectedClient(client);
  }

  // ─── Inline edit helpers ───────────────────────────────────────────────────

  function startEdit(field: string, currentValue: string) {
    setEditField(field);
    setEditValue(currentValue);
  }

  function cancelEdit() {
    setEditField(null);
    setEditValue('');
  }

  async function saveEdit(field: string, value: string) {
    if (!selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        // Update local client state
        setSelectedClient(prev => prev ? { ...prev, ...updated } : prev);
        setClients(prev => prev.map(c => c.id === selectedClient.id ? { ...c, ...updated } : c));
      }
    } catch { /* silent */ }
    setSaving(false);
    setEditField(null);
    setEditValue('');
  }

  async function saveManager(userId: string) {
    if (!selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioManagerId: userId || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        const mgr = firmUsers.find(u => u.id === userId);
        setSelectedClient(prev => prev ? {
          ...prev,
          ...updated,
          portfolioManager: mgr ? { id: mgr.id, name: mgr.name, email: mgr.email } : null,
        } : prev);
      }
    } catch { /* silent */ }
    setSaving(false);
    setEditField(null);
  }

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // ─── Editable field component ──────────────────────────────────────────────

  function EditableField({ field, label, value, type = 'text' }: {
    field: string; label: string; value: string; type?: 'text' | 'select';
  }) {
    const isEditing = editField === field;
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-xs font-medium text-slate-500 w-32 shrink-0">{label}</span>
        {isEditing ? (
          <div className="flex items-center gap-1.5 flex-1">
            {type === 'select' ? (
              <select
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SOFTWARE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt || '— None —'}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            )}
            <button
              onClick={() => saveEdit(field, editValue)}
              disabled={saving}
              className="p-1 text-green-600 hover:text-green-700 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={cancelEdit} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-sm text-slate-800">{value || '—'}</span>
            <button
              onClick={() => startEdit(field, value)}
              className="p-0.5 text-slate-300 hover:text-slate-500 transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Sort header component ─────────────────────────────────────────────────

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

  // ═════════════════════════════════════════════════════════════════════════════
  // CLIENT DETAIL VIEW
  // ═════════════════════════════════════════════════════════════════════════════

  if (selectedClient) {
    const managerCandidates = firmUsers.filter(u => u.isPortfolioOwner || u.isFirmAdmin);

    // Build a lookup: periodId -> Set of productKeys that have assignments
    const periodToolMap = new Map<string, Set<string>>();
    for (const p of periods) {
      const keys = new Set(p.productAssignments.map(a => a.productKey));
      periodToolMap.set(p.id, keys);
    }

    // Access tab data
    const accessPeriod = periods[accessPeriodIdx] ?? null;
    const accessUsers = accessPeriod
      ? Array.from(new Map(
          accessPeriod.productAssignments.map(a => [a.userId, a.user])
        ).values())
      : [];
    // Enrich with isActive status from firmUsers
    const accessUsersEnriched = accessUsers.map(u => {
      const fu = firmUsers.find(f => f.id === u.id);
      return { ...u, isActive: fu?.isActive ?? true };
    });
    const accessAssignmentSet = new Set(
      (accessPeriod?.productAssignments ?? []).map(a => `${a.userId}:${a.productKey}`)
    );

    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSelectedClient(null); setSelectedId(null); setActiveTab('overview'); }}
          className="mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back to Client List
        </Button>

        {/* ─── Client Name (editable heading) ───────────────────────────────── */}
        <div className="mb-6">
          {editField === 'clientName' ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-2xl font-bold text-slate-800 bg-transparent border-b-2 border-blue-500 focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => saveEdit('clientName', editValue)}
                disabled={saving}
                className="p-1 text-green-600 hover:text-green-700"
              >
                <Check className="h-5 w-5" />
              </button>
              <button onClick={cancelEdit} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-800">{selectedClient.clientName}</h1>
              <button
                onClick={() => startEdit('clientName', selectedClient.clientName)}
                className="p-1 text-slate-300 hover:text-slate-500 transition-colors"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <div className="flex gap-2 ml-3">
                <Badge className={selectedClient.readOnly ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>
                  {selectedClient.readOnly ? 'Read Only' : 'Active'}
                </Badge>
              </div>
            </div>
          )}
        </div>

        {/* ─── Editable fields ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6">
          <EditableField field="contactFirstName" label="First Name" value={selectedClient.contactFirstName || ''} />
          <EditableField field="contactSurname" label="Surname" value={selectedClient.contactSurname || ''} />
          <EditableField field="contactEmail" label="Contact Email" value={selectedClient.contactEmail || ''} />
          <EditableField field="software" label="Accounting System" value={selectedClient.software || ''} type="select" />

          {/* Client Manager — special dropdown */}
          <div className="flex items-center gap-2 py-1.5">
            <span className="text-xs font-medium text-slate-500 w-32 shrink-0">Client Manager</span>
            {editField === 'portfolioManagerId' ? (
              <div className="flex items-center gap-1.5 flex-1">
                <select
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— None —</option>
                  {managerCandidates.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => saveManager(editValue)}
                  disabled={saving}
                  className="p-1 text-green-600 hover:text-green-700 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={cancelEdit} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-1">
                <span className="text-sm text-slate-800">
                  {selectedClient.portfolioManager?.name || '—'}
                </span>
                <button
                  onClick={() => startEdit('portfolioManagerId', selectedClient.portfolioManagerId || '')}
                  className="p-0.5 text-slate-300 hover:text-slate-500 transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Tab toggle ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-0.5 w-fit">
          {(['overview', 'access'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'overview' ? 'Overview' : 'User Access'}
            </button>
          ))}
        </div>

        {/* ─── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {periodsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading periods...
              </div>
            ) : periods.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No accounting periods defined for this client.
              </div>
            ) : (
              <>
                {/* Table A — Period × Tools Matrix */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Tool Assignments by Period</h3>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Period
                          </th>
                          {TOOL_COLUMNS.map(t => (
                            <th
                              key={t.key}
                              className="px-2 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap"
                            >
                              {t.short}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {periods.map(p => {
                          const toolSet = periodToolMap.get(p.id) ?? new Set();
                          return (
                            <tr key={p.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                                {formatPeriod(p.startDate, p.endDate)}
                              </td>
                              {TOOL_COLUMNS.map(t => (
                                <td key={t.key} className="px-2 py-2.5 text-center">
                                  {toolSet.has(t.key) && (
                                    <span className="inline-block w-5 h-5 rounded-full bg-green-500" />
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Table B — Period / Tools / Users Summary */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Period Summary</h3>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Accounting Period
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Tools
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Access Users
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {periods.map(p => {
                          // Get unique tool names for this period
                          const toolNames = Array.from(new Set(
                            p.productAssignments.map(a => {
                              const col = TOOL_COLUMNS.find(t => t.key === a.productKey);
                              return col?.label || a.productKey;
                            })
                          ));
                          // Get unique user names
                          const userNames = Array.from(new Map(
                            p.productAssignments.map(a => [a.userId, a.user.name])
                          ).values());
                          return (
                            <tr key={p.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                                {formatPeriod(p.startDate, p.endDate)}
                              </td>
                              <td className="px-3 py-2.5 text-slate-600">
                                {toolNames.length > 0 ? toolNames.join(', ') : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-slate-600">
                                {userNames.length > 0 ? userNames.join(', ') : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── USER ACCESS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'access' && (
          <div>
            {periodsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : periods.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No accounting periods defined for this client.
              </div>
            ) : (
              <>
                {/* Period navigator */}
                <div className="flex items-center justify-center gap-3 mb-4">
                  <button
                    onClick={() => setAccessPeriodIdx(i => Math.max(0, i - 1))}
                    disabled={accessPeriodIdx === 0}
                    className="p-1 rounded-md hover:bg-slate-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5 text-slate-600" />
                  </button>
                  <span className="text-sm font-semibold text-slate-800 min-w-[200px] text-center">
                    {accessPeriod ? formatPeriod(accessPeriod.startDate, accessPeriod.endDate) : '—'}
                  </span>
                  <button
                    onClick={() => setAccessPeriodIdx(i => Math.min(periods.length - 1, i + 1))}
                    disabled={accessPeriodIdx >= periods.length - 1}
                    className="p-1 rounded-md hover:bg-slate-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5 text-slate-600" />
                  </button>
                </div>

                {/* User × Tools matrix */}
                {accessUsersEnriched.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No users assigned to this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            User
                          </th>
                          {TOOL_COLUMNS.map(t => (
                            <th
                              key={t.key}
                              className="px-2 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap"
                            >
                              {t.short}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {accessUsersEnriched.map(u => (
                          <tr key={u.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                              {u.name}
                              {!u.isActive && (
                                <span className="ml-1.5 text-[10px] text-slate-400">(inactive)</span>
                              )}
                            </td>
                            {TOOL_COLUMNS.map(t => {
                              const hasAssignment = accessAssignmentSet.has(`${u.id}:${t.key}`);
                              return (
                                <td key={t.key} className="px-2 py-2.5 text-center">
                                  {hasAssignment && (
                                    <span
                                      className={`inline-block w-5 h-5 rounded-full ${
                                        u.isActive ? 'bg-green-500' : 'bg-slate-800'
                                      }`}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // CLIENT LIST VIEW
  // ═════════════════════════════════════════════════════════════════════════════

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Clients — Manage</h1>
        <p className="text-sm text-slate-500 mt-1">Select a client to view their details</p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="pl-9 h-9"
          />
        </div>
        <Button
          size="sm"
          className="bg-blue-600 hover:bg-blue-700"
          onClick={handleSelect}
          disabled={!selectedId}
        >
          Select
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <SortHeader k="clientName" label="Client Name" />
              <SortHeader k="software" label="Software" />
              <SortHeader k="contactFirstName" label="Contact" />
              <SortHeader k="contactEmail" label="Email" />
              <th className="px-3 py-2 text-left">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Manager</span>
              </th>
              <th className="px-3 py-2 text-left">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Users</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  <Users className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  No clients found
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr
                  key={c.id}
                  className={`transition-colors cursor-pointer ${
                    selectedId === c.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <td className="px-3 py-3 font-medium text-slate-800">
                    {c.clientName}
                    {c.readOnly && (
                      <Badge variant="secondary" className="ml-2 text-[10px] bg-amber-50 text-amber-700">Read Only</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500">{c.software || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{`${c.contactFirstName || ''} ${c.contactSurname || ''}`.trim() || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c.contactEmail || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c.portfolioManager?.name || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c._count?.userAssignments || 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-2">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
    </div>
  );
}
