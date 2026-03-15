'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Loader2, Users } from 'lucide-react';

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
  contactEmail: string | null;
  _count: { subscriptions: number; userAssignments: number };
}

interface Props {
  firmId: string;
  isPortfolioOwner: boolean;
  isFirmAdmin: boolean;
  isSuperAdmin: boolean;
}

export function ClientsTab({ firmId, isPortfolioOwner, isFirmAdmin, isSuperAdmin }: Props) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ clientName: '', software: '', contactName: '', contactEmail: '' });

  async function loadClients() {
    setLoading(true);
    const res = await fetch(`/api/clients?firmId=${firmId}`);
    const data = await res.json();
    setClients(data);
    setLoading(false);
  }

  useEffect(() => { loadClients(); }, [firmId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, firmId }),
    });
    setForm({ clientName: '', software: '', contactName: '', contactEmail: '' });
    setShowForm(false);
    await loadClients();
    setSaving(false);
  }

  async function handleDelete(clientId: string) {
    if (!confirm('Delete this client? This will also remove their subscriptions.')) return;
    await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
    await loadClients();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Clients</h2>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-1" />Add Client
        </Button>
      </div>

      {showForm && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader><CardTitle className="text-base">New Client</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Client Name</Label>
                <Input value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label>Software</Label>
                <Input value={form.software} onChange={e => setForm({ ...form, software: e.target.value })} placeholder="e.g. Xero, Sage" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Email</Label>
                <Input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Client'}
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
          {clients.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Users className="h-4 w-4 text-slate-500" />
                </div>
                <div>
                  <span className="font-medium text-slate-800">{c.clientName}</span>
                  {c.software && <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c.software}</span>}
                  <div className="text-sm text-slate-500">
                    {c.contactName && `${c.contactName}`}
                    {c.contactEmail && ` · ${c.contactEmail}`}
                  </div>
                  <div className="text-xs text-slate-400">
                    {c._count.subscriptions} subscription{c._count.subscriptions !== 1 ? 's' : ''} ·{' '}
                    {c._count.userAssignments} assigned user{c._count.userAssignments !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {clients.length === 0 && (
            <div className="text-center py-12 text-slate-500">No clients yet. Add your first client above.</div>
          )}
        </div>
      )}
    </div>
  );
}
