'use client';

import { useState } from 'react';
import { Save, X } from 'lucide-react';
import { ROLE_COLORS, DEFAULT_CONCURRENT_LIMITS, type ResourceRole } from '@/lib/resource-planning/types';

interface StaffData {
  id: string;
  displayId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  isActive: boolean;
  resourceSetting: any;
}

interface Props {
  staff: StaffData[];
}

const ROLES: ResourceRole[] = ['Specialist', 'RI', 'Reviewer', 'Preparer'];

export function ResourceUserManagement({ staff: initialStaff }: Props) {
  const [staff, setStaff] = useState(initialStaff);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  function startEdit(s: StaffData) {
    setEditingId(s.id);
    const rs = s.resourceSetting;
    setEditData({
      resourceRole: rs?.resourceRole ?? 'Preparer',
      weeklyCapacityHrs: rs?.weeklyCapacityHrs ?? 37.5,
      overtimeHrs: rs?.overtimeHrs ?? 0,
      specialistJobLimit: rs?.specialistJobLimit ?? null,
      riJobLimit: rs?.riJobLimit ?? null,
      reviewerJobLimit: rs?.reviewerJobLimit ?? null,
      preparerJobLimit: rs?.preparerJobLimit ?? null,
    });
  }

  async function handleSave(userId: string) {
    setSaving(true);
    try {
      const body = {
        ...editData,
        concurrentJobLimit: DEFAULT_CONCURRENT_LIMITS[editData.resourceRole as ResourceRole],
        isRI: editData.riJobLimit != null && editData.riJobLimit > 0,
      };

      const res = await fetch(`/api/resource-planning/staff/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setStaff((prev) =>
          prev.map((s) => (s.id === userId ? { ...s, resourceSetting: { ...s.resourceSetting, ...editData } } : s)),
        );
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Staff Resource Settings</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="text-left px-3 py-2 font-medium text-slate-600">Name</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Primary Role</th>
              <th className="text-center px-3 py-2 font-medium text-slate-600">Weekly Hrs</th>
              <th className="text-center px-3 py-2 font-medium text-slate-600">Overtime</th>
              {ROLES.map((r) => (
                <th key={r} className="text-center px-2 py-2 font-medium text-slate-600 text-xs">
                  {r} Limit
                </th>
              ))}
              <th className="text-center px-3 py-2 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const isEditing = editingId === s.id;
              const rs = s.resourceSetting;
              return (
                <tr key={s.id} className="border-b hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{s.name}</div>
                    <div className="text-xs text-slate-500">{s.jobTitle}</div>
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <select
                        value={editData.resourceRole}
                        onChange={(e) => setEditData({ ...editData, resourceRole: e.target.value })}
                        className="w-full px-1 py-0.5 text-xs border rounded"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[rs?.resourceRole as ResourceRole]?.bg ?? ''} ${ROLE_COLORS[rs?.resourceRole as ResourceRole]?.text ?? ''}`}>
                        {rs?.resourceRole ?? 'Not set'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.5"
                        value={editData.weeklyCapacityHrs}
                        onChange={(e) => setEditData({ ...editData, weeklyCapacityHrs: parseFloat(e.target.value) || 37.5 })}
                        className="w-16 px-1 py-0.5 text-xs border rounded text-center"
                      />
                    ) : (
                      <span className="text-xs">{rs?.weeklyCapacityHrs ?? 37.5}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.5"
                        value={editData.overtimeHrs}
                        onChange={(e) => setEditData({ ...editData, overtimeHrs: parseFloat(e.target.value) || 0 })}
                        className="w-16 px-1 py-0.5 text-xs border rounded text-center"
                      />
                    ) : (
                      <span className="text-xs">{rs?.overtimeHrs ?? 0}</span>
                    )}
                  </td>
                  {ROLES.map((role) => {
                    const key = `${role.toLowerCase()}JobLimit` as string;
                    const altKey = role === 'RI' ? 'riJobLimit' : `${role.charAt(0).toLowerCase()}${role.slice(1)}JobLimit`;
                    const limitKey = role === 'RI' ? 'riJobLimit' : role === 'Specialist' ? 'specialistJobLimit' : `${role.toLowerCase()}JobLimit`;
                    const value = isEditing ? editData[limitKey] : rs?.[limitKey];
                    return (
                      <td key={role} className="px-2 py-2 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="checkbox"
                              checked={editData[limitKey] != null}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  [limitKey]: e.target.checked ? DEFAULT_CONCURRENT_LIMITS[role] : null,
                                })
                              }
                              className="h-3 w-3"
                            />
                            {editData[limitKey] != null && (
                              <input
                                type="number"
                                min={1}
                                value={editData[limitKey]}
                                onChange={(e) => setEditData({ ...editData, [limitKey]: parseInt(e.target.value) || 1 })}
                                className="w-10 px-0.5 py-0.5 text-xs border rounded text-center"
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-xs">{value != null ? value : '—'}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    {isEditing ? (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleSave(s.id)}
                          disabled={saving}
                          className="p-1 rounded bg-green-100 hover:bg-green-200 text-green-700"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(s)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
