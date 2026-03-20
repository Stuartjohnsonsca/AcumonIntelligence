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
  Loader2, Search, ChevronUp, ChevronDown, ArrowLeft, Users,
  User, Mail, Building2, Calendar,
} from 'lucide-react';

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
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

type SortKey = 'clientName' | 'software' | 'contactName' | 'contactEmail';
type SortDir = 'asc' | 'desc';

export default function ManagePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('clientName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const firmId = (session?.user as { firmId?: string })?.firmId;

  const loadClients = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    const res = await fetch(`/api/clients?firmId=${firmId}`);
    const data = await res.json();
    setClients(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [firmId]);

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (firmId) loadClients();
  }, [status, firmId, router, loadClients]);

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
        (c.contactName || '').toLowerCase().includes(term)
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

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

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

  // Client detail screen
  if (selectedClient) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSelectedClient(null); setSelectedId(null); }}
          className="mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back to Client List
        </Button>

        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{selectedClient.clientName}</h1>
            <div className="flex gap-2 mt-2">
              <Badge className={selectedClient.readOnly ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>
                {selectedClient.readOnly ? 'Read Only' : 'Active'}
              </Badge>
              {selectedClient.software && (
                <Badge variant="secondary">{selectedClient.software}</Badge>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Details Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Client Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-slate-500">Contact Name</Label>
                  <p className="text-sm font-medium text-slate-800">{selectedClient.contactName || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Contact Email</Label>
                  <p className="text-sm font-medium text-slate-800">{selectedClient.contactEmail || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Accounting System</Label>
                  <p className="text-sm font-medium text-slate-800">{selectedClient.software || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Portfolio Manager</Label>
                  <p className="text-sm font-medium text-slate-800">{selectedClient.portfolioManager?.name || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Created</Label>
                  <p className="text-sm font-medium text-slate-800">
                    {new Date(selectedClient.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Assigned Users Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Assigned Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedClient.userAssignments && selectedClient.userAssignments.length > 0 ? (
                  <div className="space-y-2">
                    {selectedClient.userAssignments.map((a) => (
                      <div key={a.user.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50">
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <User className="h-4 w-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{a.user.name}</p>
                          <p className="text-xs text-slate-500">{a.user.email}</p>
                        </div>
                        <Badge variant="secondary" className="ml-auto text-[10px]">{a.user.displayId}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No users assigned</p>
                )}
              </CardContent>
            </Card>

            {/* Connections Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Accounting Connections
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedClient.accountingConnections && selectedClient.accountingConnections.length > 0 ? (
                  <div className="space-y-2">
                    {selectedClient.accountingConnections.map((conn, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-green-50">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-green-700">{conn.orgName || conn.system}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No active connections</p>
                )}
              </CardContent>
            </Card>

            {/* Subscriptions Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Active Subscriptions</span>
                  <span className="font-medium text-slate-800">{selectedClient._count?.subscriptions || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Assigned Users</span>
                  <span className="font-medium text-slate-800">{selectedClient._count?.userAssignments || 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Client list
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
              <SortHeader k="contactName" label="Contact" />
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
                  <td className="px-3 py-3 text-slate-500">{c.contactName || '—'}</td>
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
