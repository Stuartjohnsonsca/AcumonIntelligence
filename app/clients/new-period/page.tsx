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
  Loader2, Search, ChevronUp, ChevronDown, ArrowLeft, Plus,
  Calendar, Users, Check, X, Trash2,
} from 'lucide-react';
import { ALL_PRODUCT_CATEGORIES } from '@/lib/products';

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
  contactEmail: string | null;
  isActive: boolean;
  readOnly: boolean;
  createdAt: string;
}

interface ProductAssignment {
  id: string;
  productKey: string;
  category: string;
  userId: string;
  user: { id: string; name: string; email: string; displayId: string };
}

interface Period {
  id: string;
  clientId: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  productAssignments: ProductAssignment[];
}

interface FirmUser {
  id: string;
  name: string;
  email: string;
  displayId: string;
}

type SortKey = 'clientName';
type SortDir = 'asc' | 'desc';
type Step = 'select-client' | 'manage-periods';

export default function NewPeriodPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [step, setStep] = useState<Step>('select-client');

  // Period management
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [newEndDate, setNewEndDate] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [showStartDate, setShowStartDate] = useState(false);
  const [addingPeriod, setAddingPeriod] = useState(false);
  const [periodError, setPeriodError] = useState('');

  // Product assignment
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [assigningUser, setAssigningUser] = useState(false);
  const [deletingPeriod, setDeletingPeriod] = useState(false);

  const firmId = (session?.user as { firmId?: string })?.firmId;

  const loadClients = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    const res = await fetch(`/api/clients?firmId=${firmId}`);
    const data = await res.json();
    setClients(Array.isArray(data) ? (data as Client[]).filter((c) => c.isActive) : []);
    setLoading(false);
  }, [firmId]);

  const loadFirmUsers = useCallback(async () => {
    if (!firmId) return;
    const res = await fetch(`/api/users?firmId=${firmId}`);
    const data = await res.json();
    setFirmUsers(Array.isArray(data) ? data : []);
  }, [firmId]);

  const loadPeriods = useCallback(async (clientId: string) => {
    setPeriodsLoading(true);
    const res = await fetch(`/api/clients/${clientId}/periods`);
    const data = await res.json();
    setPeriods(Array.isArray(data) ? data : []);
    setPeriodsLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (firmId) { loadClients(); loadFirmUsers(); }
  }, [status, firmId, router, loadClients, loadFirmUsers]);

  const filtered = clients
    .filter((c) => {
      if (!search) return true;
      return c.clientName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const av = a.clientName.toLowerCase();
      const bv = b.clientName.toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  function handleSelectClient() {
    if (!selectedClientId) return;
    const client = clients.find((c) => c.id === selectedClientId);
    if (!client) return;
    setSelectedClient(client);
    setStep('manage-periods');
    loadPeriods(selectedClientId);
  }

  function computeDefaultStartDate(): string {
    if (periods.length === 0) return '';
    // Sort by endDate descending
    const sorted = [...periods].sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
    const lastEnd = new Date(sorted[0].endDate);
    lastEnd.setDate(lastEnd.getDate() + 1);
    return lastEnd.toISOString().slice(0, 10);
  }

  function handleEndDateChange(endDateStr: string) {
    setNewEndDate(endDateStr);
    setPeriodError('');

    if (periods.length === 0) {
      setShowStartDate(true);
      return;
    }

    const endDate = new Date(endDateStr);
    const sorted = [...periods].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const earliest = new Date(sorted[0].startDate);

    if (endDate < earliest) {
      setShowStartDate(true);
    } else {
      setShowStartDate(false);
      setNewStartDate(computeDefaultStartDate());
    }
  }

  async function handleAddPeriod() {
    if (!selectedClient || !newEndDate) return;

    let startDate: string;
    if (showStartDate || periods.length === 0) {
      if (!newStartDate) { setPeriodError('Please select a start date'); return; }
      startDate = newStartDate;
    } else {
      startDate = computeDefaultStartDate();
    }

    if (!startDate) { setPeriodError('Could not determine start date'); return; }

    if (new Date(newEndDate) <= new Date(startDate)) {
      setPeriodError('End date must be after start date');
      return;
    }

    setAddingPeriod(true);
    setPeriodError('');

    const res = await fetch(`/api/clients/${selectedClient.id}/periods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate: newEndDate }),
    });

    const data = await res.json();
    if (!res.ok) {
      setPeriodError(data.error || 'Failed to create period');
      setAddingPeriod(false);
      return;
    }

    setNewEndDate('');
    setNewStartDate('');
    setShowStartDate(false);
    await loadPeriods(selectedClient.id);
    setAddingPeriod(false);
  }

  async function handleDeletePeriod(periodId: string) {
    if (!selectedClient) return;
    if (!confirm('Delete this period? This will also remove all product assignments.')) return;
    setDeletingPeriod(true);
    await fetch(`/api/clients/${selectedClient.id}/periods/${periodId}`, { method: 'DELETE' });
    if (selectedPeriodId === periodId) setSelectedPeriodId(null);
    await loadPeriods(selectedClient.id);
    setDeletingPeriod(false);
  }

  function toggleProduct(key: string) {
    const next = new Set(selectedProducts);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedProducts(next);
  }

  async function handleAssignUser(userId: string) {
    if (!selectedClient || !selectedPeriodId || selectedProducts.size === 0) return;
    setAssigningUser(true);

    const productKeys = [...selectedProducts].map((key) => {
      const cat = ALL_PRODUCT_CATEGORIES.find((c) => c.products.some((p) => p.urlPrefix === key));
      return { key, category: cat?.category || 'Unknown' };
    });

    await fetch(`/api/clients/${selectedClient.id}/periods/${selectedPeriodId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productKeys, userId }),
    });

    setSelectedProducts(new Set());
    setShowUserPicker(false);
    await loadPeriods(selectedClient.id);
    setAssigningUser(false);
  }

  async function handleRemoveAssignment(productKey: string, userId: string) {
    if (!selectedClient || !selectedPeriodId) return;
    await fetch(`/api/clients/${selectedClient.id}/periods/${selectedPeriodId}/assignments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productKeys: [productKey], userId }),
    });
    await loadPeriods(selectedClient.id);
  }

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const assignmentsByProduct = new Map<string, ProductAssignment[]>();
  if (selectedPeriod) {
    for (const a of selectedPeriod.productAssignments) {
      const existing = assignmentsByProduct.get(a.productKey) || [];
      existing.push(a);
      assignmentsByProduct.set(a.productKey, existing);
    }
  }

  // ── Client Selection ──
  if (step === 'select-client') {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Create New Period</h1>
          <p className="text-sm text-slate-500 mt-1">Select a client to manage their periods</p>
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
            onClick={handleSelectClient}
            disabled={!selectedClientId}
          >
            Select
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left">
                  <button
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-600 uppercase tracking-wide hover:text-slate-900"
                  >
                    Client Name
                    {sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Software</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Contact</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-slate-400">No clients found</td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr
                    key={c.id}
                    className={`transition-colors cursor-pointer ${
                      selectedClientId === c.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedClientId(c.id)}
                  >
                    <td className="px-3 py-3 font-medium text-slate-800">{c.clientName}</td>
                    <td className="px-3 py-3 text-slate-500">{c.software || '—'}</td>
                    <td className="px-3 py-3 text-slate-500">{c.contactName || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Period Management ──
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setStep('select-client');
          setSelectedClient(null);
          setSelectedClientId(null);
          setSelectedPeriodId(null);
          setPeriods([]);
        }}
        className="mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Back to Client List
      </Button>

      <h1 className="text-2xl font-bold text-slate-800 mb-6">{selectedClient?.clientName}</h1>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Left: Periods list + add new */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Periods
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {periodsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
              ) : periods.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">No periods yet</p>
              ) : (
                periods.map((p) => {
                  const start = new Date(p.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  const end = new Date(p.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  const isSelected = selectedPeriodId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                      }`}
                      onClick={() => {
                        setSelectedPeriodId(p.id);
                        setSelectedProducts(new Set());
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">{start} — {end}</p>
                        <p className="text-xs text-slate-500">{p.productAssignments.length} assignment{p.productAssignments.length !== 1 ? 's' : ''}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePeriod(p.id); }}
                        disabled={deletingPeriod}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="Delete period"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Add new period */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader>
              <CardTitle className="text-sm">Add New Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(showStartDate || periods.length === 0) && (
                <div className="space-y-1">
                  <Label className="text-xs">Start Date</Label>
                  <Input
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              )}
              {periods.length > 0 && !showStartDate && (
                <p className="text-xs text-slate-500">
                  Start: <span className="font-medium">{computeDefaultStartDate() || '—'}</span> (day after last period)
                </p>
              )}
              <div className="space-y-1">
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  value={newEndDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              {periodError && (
                <p className="text-xs text-red-600">{periodError}</p>
              )}
              <Button
                size="sm"
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={handleAddPeriod}
                disabled={addingPeriod || !newEndDate}
              >
                {addingPeriod ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Add Period
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Product assignment grid */}
        <div>
          {!selectedPeriodId ? (
            <div className="flex items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-lg">
              <p className="text-slate-400">Select a period to manage product assignments</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">Product Assignments</h2>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => setShowUserPicker(true)}
                  disabled={selectedProducts.size === 0}
                >
                  <Users className="h-3.5 w-3.5 mr-1" />
                  Assign to User ({selectedProducts.size})
                </Button>
              </div>

              {/* Three column grid */}
              <div className="grid md:grid-cols-3 gap-4">
                {ALL_PRODUCT_CATEGORIES.map((cat) => (
                  <Card key={cat.category}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-slate-700">{cat.category}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      {cat.products.map((product) => {
                        const key = product.urlPrefix;
                        const isSelected = selectedProducts.has(key);
                        const assignments = assignmentsByProduct.get(key) || [];
                        return (
                          <div
                            key={key}
                            className={`p-2 rounded-md border transition-colors ${
                              isSelected
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-white border-slate-100 hover:border-slate-200'
                            }`}
                          >
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleProduct(key)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800">{product.navLabel || product.name}</p>
                                {assignments.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {assignments.map((a) => (
                                      <div key={a.id} className="flex items-center gap-1 text-xs text-blue-700">
                                        <span className="truncate">{a.user.name}</span>
                                        <button
                                          onClick={(e) => { e.preventDefault(); handleRemoveAssignment(key, a.userId); }}
                                          className="text-red-400 hover:text-red-600 flex-shrink-0"
                                          title="Remove assignment"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </label>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User picker modal */}
      {showUserPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowUserPicker(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[70vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">Assign Products to User</h3>
              <p className="text-xs text-slate-500 mt-1">
                {selectedProducts.size} product{selectedProducts.size !== 1 ? 's' : ''} selected
              </p>
            </div>
            <div className="overflow-y-auto max-h-[50vh] divide-y divide-slate-100">
              {firmUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => handleAssignUser(u.id)}
                  disabled={assigningUser}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-blue-700">
                      {u.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{u.name}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  </div>
                  <Badge variant="secondary" className="ml-auto flex-shrink-0 text-[10px]">{u.displayId}</Badge>
                </button>
              ))}
              {firmUsers.length === 0 && (
                <p className="px-5 py-4 text-sm text-slate-400">No users found</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowUserPicker(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
