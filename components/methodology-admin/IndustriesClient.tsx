'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Loader2, Lock } from 'lucide-react';

interface Industry {
  id: string;
  firmId: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
}

interface Props {
  firmId: string;
  initialIndustries: Industry[];
}

export function IndustriesClient({ firmId, initialIndustries }: Props) {
  const [industries, setIndustries] = useState<Industry[]>(initialIndustries);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!newName.trim() || !newCode.trim()) {
      setError('Name and code are required');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/methodology-admin/industries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, name: newName.trim(), code: newCode.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to add');
        return;
      }
      const data = await res.json();
      setIndustries((prev) => [...prev, data.industry]);
      setNewName('');
      setNewCode('');
    } catch {
      setError('Failed to add industry');
    } finally {
      setAdding(false);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/methodology-admin/industries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: !isActive }),
      });
      setIndustries((prev) => prev.map((i) => (i.id === id ? { ...i, isActive: !isActive } : i)));
    } catch {
      // silently fail
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this industry?')) return;
    try {
      await fetch('/api/methodology-admin/industries', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setIndustries((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // silently fail
    }
  };

  return (
    <div className="space-y-6">
      {/* Add new */}
      <div className="border rounded-lg p-4 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Add New Industry</h3>
        <div className="flex items-end space-x-3">
          <div className="flex-1">
            <label className="text-xs text-slate-500 mb-1 block">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Financial Services"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="text-xs text-slate-500 mb-1 block">Code</label>
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="e.g. finserv"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button onClick={handleAdd} disabled={adding} size="sm" className="bg-blue-600 hover:bg-blue-700">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            Add
          </Button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* List */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left text-sm font-medium text-slate-600 p-3">Name</th>
              <th className="text-left text-sm font-medium text-slate-600 p-3 w-32">Code</th>
              <th className="text-center text-sm font-medium text-slate-600 p-3 w-24">Active</th>
              <th className="text-center text-sm font-medium text-slate-600 p-3 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {industries.map((ind) => (
              <tr key={ind.id} className={`border-t hover:bg-slate-50 ${!ind.isActive ? 'opacity-50' : ''}`}>
                <td className="p-3 text-sm text-slate-700 flex items-center space-x-2">
                  <span>{ind.name}</span>
                  {ind.isDefault && <Lock className="h-3 w-3 text-slate-400" title="Default - cannot delete" />}
                </td>
                <td className="p-3 text-sm text-slate-500 font-mono">{ind.code}</td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => !ind.isDefault && handleToggleActive(ind.id, ind.isActive)}
                    disabled={ind.isDefault}
                    className={`h-5 w-5 rounded-full border-2 inline-block transition-colors ${
                      ind.isActive ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'
                    } ${ind.isDefault ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  />
                </td>
                <td className="p-3 text-center">
                  {!ind.isDefault && (
                    <button
                      onClick={() => handleDelete(ind.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {industries.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-slate-400 text-sm">No industries defined yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
