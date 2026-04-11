'use client';

import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import type { ResourceRole } from '@/lib/resource-planning/types';

interface StaffData {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  isActive: boolean;
  resourceSetting: any;
}

interface Props {
  staff: StaffData[];
  specialistRoles: string[];
}

const PRIMARY_ROLES: ResourceRole[] = ['Specialist', 'RI', 'Reviewer', 'Preparer'];

const CORE_CIRCLES: { role: string; color: string; limitKey: string }[] = [
  { role: 'Preparer', color: 'bg-blue-500',   limitKey: 'preparerJobLimit' },
  { role: 'Reviewer', color: 'bg-purple-500', limitKey: 'reviewerJobLimit' },
  { role: 'RI',       color: 'bg-amber-500',  limitKey: 'riJobLimit' },
];

function initRow(rs: any, specialistRoles: string[]) {
  const specialistJobLimits: Record<string, number | null> = {};
  for (const role of specialistRoles) {
    specialistJobLimits[role] = rs?.specialistJobLimits?.[role] ?? null;
  }
  return {
    resourceRole:      rs?.resourceRole      ?? 'Preparer',
    weeklyCapacityHrs: rs?.weeklyCapacityHrs ?? 37.5,
    overtimeHrs:       rs?.overtimeHrs       ?? 15,
    preparerJobLimit:  rs?.preparerJobLimit  ?? null,
    reviewerJobLimit:  rs?.reviewerJobLimit  ?? null,
    riJobLimit:        rs?.riJobLimit        ?? null,
    specialistJobLimits,
  };
}

function UserRow({ s, specialistRoles }: { s: StaffData; specialistRoles: string[] }) {
  const [data, setData] = useState(() => initRow(s.resourceSetting, specialistRoles));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function set(field: string, value: any) {
    setData(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  function toggleCore(limitKey: string) {
    setData(prev => ({ ...prev, [limitKey]: (prev as any)[limitKey] != null ? null : 5 }));
    setSaved(false);
  }

  function toggleSpecialist(role: string) {
    setData(prev => ({
      ...prev,
      specialistJobLimits: {
        ...prev.specialistJobLimits,
        [role]: prev.specialistJobLimits[role] != null ? null : 5,
      },
    }));
    setSaved(false);
  }

  function setSpecialistLimit(role: string, val: number) {
    setData(prev => ({
      ...prev,
      specialistJobLimits: { ...prev.specialistJobLimits, [role]: val },
    }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/resource-planning/staff/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          concurrentJobLimit: data.preparerJobLimit ?? data.reviewerJobLimit ?? data.riJobLimit ?? 5,
          isRI: data.riJobLimit != null && data.riJobLimit > 0,
        }),
      });
      if (res.ok) setSaved(true);
    } finally { setSaving(false); }
  }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/50">
      {/* Name */}
      <td className="px-3 py-3 align-top">
        <div className="text-sm font-medium text-slate-800">{s.name}</div>
        <div className="text-xs text-slate-400">{s.jobTitle || s.email}</div>
      </td>

      {/* Primary Role */}
      <td className="px-3 py-3 align-top">
        <select value={data.resourceRole} onChange={e => set('resourceRole', e.target.value)}
          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white">
          {PRIMARY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>

      {/* Specialist role circles (dynamic) */}
      {specialistRoles.map(role => {
        const enabled = data.specialistJobLimits[role] != null;
        return (
          <td key={role} className="px-3 py-3 align-top text-center">
            <div className="flex flex-col items-center gap-1">
              <button onClick={() => toggleSpecialist(role)}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                  enabled ? 'bg-teal-500 text-white shadow-sm' : 'bg-slate-200 text-slate-400'
                }`}>
                {role[0]}
              </button>
              <input
                type="number" min={0} max={99}
                value={enabled ? (data.specialistJobLimits[role] ?? 0) : 0}
                disabled={!enabled}
                onChange={e => setSpecialistLimit(role, parseInt(e.target.value) || 0)}
                className={`w-12 text-xs text-center border rounded py-0.5 px-1 ${
                  enabled ? 'border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                }`}
              />
            </div>
          </td>
        );
      })}

      {/* Core role circles: Preparer, Reviewer, RI */}
      {CORE_CIRCLES.map(({ role, color, limitKey }) => {
        const enabled = (data as any)[limitKey] != null;
        return (
          <td key={role} className="px-3 py-3 align-top text-center">
            <div className="flex flex-col items-center gap-1">
              <button onClick={() => toggleCore(limitKey)}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  enabled ? `${color} text-white shadow-sm` : 'bg-slate-200 text-slate-400'
                }`}>
                {role[0]}
              </button>
              <input
                type="number" min={0} max={99}
                value={enabled ? (data as any)[limitKey] : 0}
                disabled={!enabled}
                onChange={e => set(limitKey, parseInt(e.target.value) || 0)}
                className={`w-12 text-xs text-center border rounded py-0.5 px-1 ${
                  enabled ? 'border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                }`}
              />
            </div>
          </td>
        );
      })}

      {/* Overtime */}
      <td className="px-3 py-3 align-top text-center">
        <input type="number" min={0} step={0.5}
          value={data.overtimeHrs}
          onChange={e => set('overtimeHrs', parseFloat(e.target.value) || 0)}
          className="w-14 text-xs text-center border border-slate-200 rounded py-1 px-1 bg-white" />
      </td>

      {/* Weekly Hrs */}
      <td className="px-3 py-3 align-top text-center">
        <input type="number" min={0} step={0.5}
          value={data.weeklyCapacityHrs}
          onChange={e => set('weeklyCapacityHrs', parseFloat(e.target.value) || 37.5)}
          className="w-14 text-xs text-center border border-slate-200 rounded py-1 px-1 bg-white" />
      </td>

      {/* Save */}
      <td className="px-3 py-3 align-top text-center">
        <button onClick={handleSave} disabled={saving}
          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
            saved ? 'bg-green-100 text-green-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          } disabled:opacity-50`}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {saved ? 'Saved' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

export function ResourceUserManagement({ staff, specialistRoles }: Props) {
  if (staff.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400 text-sm">
        No audit staff found. Assign users to Audit in the Staff Setup tab first.
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-800 mb-4">User Settings</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">Name</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">Primary Role</th>
              {specialistRoles.map(role => (
                <th key={role} className="text-center px-3 py-2 text-xs font-semibold text-teal-600 uppercase tracking-wide">{role}</th>
              ))}
              <th className="text-center px-3 py-2 text-xs font-semibold text-blue-600 uppercase tracking-wide">Preparer</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-purple-600 uppercase tracking-wide">Reviewer</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-amber-600 uppercase tracking-wide">RI</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">Overtime</th>
              <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">Weekly Hrs</th>
              <th className="px-3 py-2"></th>
            </tr>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-400">
              <td colSpan={2}></td>
              {specialistRoles.map(role => (
                <td key={role} className="text-center pb-1">circle = eligible<br/>number = max jobs</td>
              ))}
              <td className="text-center pb-1">circle = eligible<br/>number = max jobs</td>
              <td className="text-center pb-1">circle = eligible<br/>number = max jobs</td>
              <td className="text-center pb-1">circle = eligible<br/>number = max jobs</td>
              <td className="text-center pb-1">hrs/week</td>
              <td className="text-center pb-1">hrs/week</td>
              <td></td>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => <UserRow key={s.id} s={s} specialistRoles={specialistRoles} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
