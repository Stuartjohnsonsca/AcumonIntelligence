'use client';

import { useState } from 'react';
import type { ResourceJobProfile } from '@/lib/resource-planning/types';

interface ClientData {
  id: string;
  clientName: string;
  resourceCategoryId: string | null;
  resourceCategoryName: string | null;
  serviceType: string | null;
  rollForwardTimeframe: string | null;
}

interface Props {
  clients: ClientData[];
  profiles: ResourceJobProfile[];
  firmId: string;
}

export function ResourceClientSettings({ clients: initialClients, profiles, firmId }: Props) {
  const [clients, setClients] = useState(initialClients);
  const [saving, setSaving] = useState<string | null>(null);

  async function handleCategoryChange(clientId: string, profileId: string | null) {
    setSaving(clientId);
    try {
      const res = await fetch(`/api/resource-planning/client-settings/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceCategoryId: profileId || null }),
      });

      if (res.ok) {
        const profile = profiles.find((p) => p.id === profileId);
        setClients((prev) =>
          prev.map((c) =>
            c.id === clientId
              ? { ...c, resourceCategoryId: profileId, resourceCategoryName: profile?.name ?? null }
              : c,
          ),
        );
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-800 mb-2">Client Resource Settings</h2>
      <p className="text-sm text-slate-500 mb-4">
        Fields marked with <span className="text-amber-600 font-medium">CRM</span> are synced from Power Apps and cannot be edited here.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="text-left px-3 py-2 font-medium text-slate-600">Client</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">
                Service Type <span className="text-amber-600 text-[10px]">CRM</span>
              </th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">
                Roll Forward <span className="text-amber-600 text-[10px]">CRM</span>
              </th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Resource Category</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">{c.clientName}</td>
                <td className="px-3 py-2 text-slate-500">
                  {c.serviceType || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {c.rollForwardTimeframe || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={c.resourceCategoryId ?? ''}
                    onChange={(e) => handleCategoryChange(c.id, e.target.value || null)}
                    disabled={saving === c.id}
                    className="w-full px-2 py-1 text-xs border rounded-md disabled:opacity-50"
                  >
                    <option value="">No category</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
