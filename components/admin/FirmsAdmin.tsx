'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Trash2, Loader2, Building2 } from 'lucide-react';
import Link from 'next/link';

interface Firm {
  id: string;
  name: string;
  _count: { users: number; clients: number };
}

export function FirmsAdmin() {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [firmName, setFirmName] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadFirms() {
    setLoading(true);
    const res = await fetch('/api/firms');
    const data = await res.json();
    setFirms(data);
    setLoading(false);
  }

  useEffect(() => { loadFirms(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/firms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: firmName }),
    });
    setFirmName('');
    setShowForm(false);
    await loadFirms();
    setSaving(false);
  }

  async function handleDelete(firmId: string) {
    if (!confirm('Delete this firm? This cannot be undone.')) return;
    await fetch(`/api/firms/${firmId}`, { method: 'DELETE' });
    await loadFirms();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Firms</h2>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-1" />Add Firm
        </Button>
      </div>

      {showForm && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardContent className="p-4">
            <form onSubmit={handleCreate} className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label>Firm Name</Label>
                <Input value={firmName} onChange={e => setFirmName(e.target.value)} required placeholder="e.g. Smith & Co Accounting" />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="space-y-2">
          {firms.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-slate-500" />
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">{f.name}</span>
                      <div className="text-sm text-slate-500">
                        {f._count.users} user{f._count.users !== 1 ? 's' : ''} ·{' '}
                        {f._count.clients} client{f._count.clients !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/my-account/admin/firms/${f.id}`}>View Details</Link>
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(f.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {firms.length === 0 && (
            <div className="text-center py-12 text-slate-500">No firms yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
