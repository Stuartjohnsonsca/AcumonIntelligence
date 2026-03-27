'use client';

import { useState } from 'react';
import { Plus, Trash2, Save, X, RefreshCw } from 'lucide-react';
import type { ResourceJobProfile } from '@/lib/resource-planning/types';

interface Props {
  profiles: ResourceJobProfile[];
  onProfilesChange: (profiles: ResourceJobProfile[]) => void;
  firmId: string;
}

interface EditState {
  name: string;
  budgetHoursSpecialist: number;
  budgetHoursRI: number;
  budgetHoursReviewer: number;
  budgetHoursPreparer: number;
  isDefault: boolean;
}

const emptyProfile: EditState = {
  name: '',
  budgetHoursSpecialist: 0,
  budgetHoursRI: 10,
  budgetHoursReviewer: 20,
  budgetHoursPreparer: 40,
  isDefault: false,
};

export function ResourceJobProfiles({ profiles, onProfilesChange, firmId }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editData, setEditData] = useState<EditState>(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  function startEdit(p: ResourceJobProfile) {
    setEditingId(p.id);
    setIsCreating(false);
    setEditData({
      name: p.name,
      budgetHoursSpecialist: p.budgetHoursSpecialist,
      budgetHoursRI: p.budgetHoursRI,
      budgetHoursReviewer: p.budgetHoursReviewer,
      budgetHoursPreparer: p.budgetHoursPreparer,
      isDefault: p.isDefault,
    });
  }

  function startCreate() {
    setEditingId(null);
    setIsCreating(true);
    setEditData({ ...emptyProfile });
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (isCreating) {
        const res = await fetch('/api/resource-planning/job-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editData),
        });
        if (res.ok) {
          const newProfile = await res.json();
          onProfilesChange([...profiles, newProfile]);
          setIsCreating(false);
        }
      } else if (editingId) {
        const res = await fetch(`/api/resource-planning/job-profiles/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editData),
        });
        if (res.ok) {
          onProfilesChange(profiles.map((p) => (p.id === editingId ? { ...p, ...editData } : p)));
          setEditingId(null);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this profile? This cannot be undone.')) return;
    const res = await fetch(`/api/resource-planning/job-profiles/${id}`, { method: 'DELETE' });
    if (res.ok) {
      onProfilesChange(profiles.filter((p) => p.id !== id));
    } else {
      const data = await res.json();
      alert(data.error || 'Cannot delete profile');
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setIsCreating(false);
  }

  async function handleSyncFromCRM() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/resource-planning/job-profiles/service-types');
      if (!res.ok) {
        const d = await res.json();
        setSyncMsg(`Error: ${d.error || res.statusText}`);
        return;
      }
      const { serviceTypes } = await res.json();
      const existingNames = new Set(profiles.map(p => p.name.toLowerCase()));
      const newTypes = (serviceTypes as string[]).filter(t => !existingNames.has(t.toLowerCase()));

      if (newTypes.length === 0) {
        setSyncMsg('All CRM service types already have profiles.');
        return;
      }

      const created: ResourceJobProfile[] = [];
      for (const name of newTypes) {
        const r = await fetch('/api/resource-planning/job-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, budgetHoursSpecialist: 0, budgetHoursRI: 10, budgetHoursReviewer: 20, budgetHoursPreparer: 40, isDefault: false }),
        });
        if (r.ok) {
          const data = await r.json();
          created.push(data.profile ?? data);
        }
      }

      if (created.length > 0) {
        onProfilesChange([...profiles, ...created]);
        setSyncMsg(`Created ${created.length} profile${created.length > 1 ? 's' : ''}: ${created.map(p => p.name).join(', ')}`);
      } else {
        setSyncMsg('No new profiles could be created.');
      }
    } catch (err: any) {
      setSyncMsg(`Error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Job Resource Profiles</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncFromCRM}
            disabled={syncing}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync from CRM'}
          </button>
          <button
            onClick={startCreate}
            disabled={isCreating}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Profile
          </button>
        </div>
      </div>
      {syncMsg && (
        <div className="mb-3 px-3 py-2 rounded text-xs bg-slate-50 border border-slate-200 text-slate-600">
          {syncMsg}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="text-left px-3 py-2 font-medium text-slate-600">Profile Name</th>
              <th className="text-center px-3 py-2 font-medium text-teal-700 text-xs">Specialist Hrs</th>
              <th className="text-center px-3 py-2 font-medium text-amber-700 text-xs">RI Hrs</th>
              <th className="text-center px-3 py-2 font-medium text-purple-700 text-xs">Reviewer Hrs</th>
              <th className="text-center px-3 py-2 font-medium text-blue-700 text-xs">Preparer Hrs</th>
              <th className="text-center px-3 py-2 font-medium text-slate-600 text-xs">Total</th>
              <th className="text-center px-3 py-2 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isCreating && (
              <ProfileEditRow
                data={editData}
                onChange={setEditData}
                onSave={handleSave}
                onCancel={cancelEdit}
                saving={saving}
              />
            )}
            {profiles.map((p) => {
              const isEditing = editingId === p.id;
              if (isEditing) {
                return (
                  <ProfileEditRow
                    key={p.id}
                    data={editData}
                    onChange={setEditData}
                    onSave={handleSave}
                    onCancel={cancelEdit}
                    saving={saving}
                  />
                );
              }
              const total = p.budgetHoursSpecialist + p.budgetHoursRI + p.budgetHoursReviewer + p.budgetHoursPreparer;
              return (
                <tr key={p.id} className="border-b hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {p.name}
                    {p.isDefault && <span className="ml-1 text-[10px] text-indigo-600 font-normal">(default)</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">{p.budgetHoursSpecialist}</td>
                  <td className="px-3 py-2 text-center text-xs">{p.budgetHoursRI}</td>
                  <td className="px-3 py-2 text-center text-xs">{p.budgetHoursReviewer}</td>
                  <td className="px-3 py-2 text-center text-xs">{p.budgetHoursPreparer}</td>
                  <td className="px-3 py-2 text-center text-xs font-medium">{total}</td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {profiles.length === 0 && !isCreating && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                  No profiles yet. Click &quot;Add Profile&quot; to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfileEditRow({
  data,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  data: EditState;
  onChange: (d: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const total = data.budgetHoursSpecialist + data.budgetHoursRI + data.budgetHoursReviewer + data.budgetHoursPreparer;

  return (
    <tr className="border-b bg-blue-50/50">
      <td className="px-3 py-2">
        <input
          type="text"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          placeholder="Profile name"
          className="w-full px-2 py-1 text-xs border rounded"
          autoFocus
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="number"
          value={data.budgetHoursSpecialist}
          onChange={(e) => onChange({ ...data, budgetHoursSpecialist: parseFloat(e.target.value) || 0 })}
          className="w-14 px-1 py-1 text-xs border rounded text-center"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="number"
          value={data.budgetHoursRI}
          onChange={(e) => onChange({ ...data, budgetHoursRI: parseFloat(e.target.value) || 0 })}
          className="w-14 px-1 py-1 text-xs border rounded text-center"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="number"
          value={data.budgetHoursReviewer}
          onChange={(e) => onChange({ ...data, budgetHoursReviewer: parseFloat(e.target.value) || 0 })}
          className="w-14 px-1 py-1 text-xs border rounded text-center"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="number"
          value={data.budgetHoursPreparer}
          onChange={(e) => onChange({ ...data, budgetHoursPreparer: parseFloat(e.target.value) || 0 })}
          className="w-14 px-1 py-1 text-xs border rounded text-center"
        />
      </td>
      <td className="px-3 py-2 text-center text-xs font-medium">{total}</td>
      <td className="px-3 py-2 text-center">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={onSave}
            disabled={saving || !data.name.trim()}
            className="p-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
          </button>
          <button onClick={onCancel} className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
