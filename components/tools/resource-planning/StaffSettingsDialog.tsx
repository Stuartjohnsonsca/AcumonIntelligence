'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';

interface Props {
  userId: string;
  onClose: () => void;
}

export function StaffSettingsDialog({ userId, onClose }: Props) {
  const staff = useResourcePlanningStore((s) => s.staff);
  const updateStaffSetting = useResourcePlanningStore((s) => s.updateStaffSetting);

  const member = staff.find((s) => s.id === userId);
  if (!member) return null;

  const setting = member.resourceSetting;

  const [role, setRole] = useState<'Preparer' | 'Reviewer' | 'RI'>(setting?.resourceRole ?? 'Preparer');
  const [capacity, setCapacity] = useState(setting?.weeklyCapacityHrs ?? 37.5);
  const [jobLimit, setJobLimit] = useState(setting?.concurrentJobLimit ?? 3);
  const [isRI, setIsRI] = useState(setting?.isRI ?? false);
  const [overtimeHrs, setOvertimeHrs] = useState(setting?.overtimeHrs ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/resource-planning/staff/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceRole: role,
          weeklyCapacityHrs: capacity,
          concurrentJobLimit: jobLimit,
          isRI,
        }),
      });

      if (res.ok) {
        updateStaffSetting(userId, {
          resourceRole: role as any,
          weeklyCapacityHrs: capacity,
          concurrentJobLimit: jobLimit,
          isRI,
        });
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[380px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">{member.name} - Settings</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Resource Role</label>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as 'Preparer' | 'Reviewer' | 'RI');
                if (e.target.value === 'Preparer') setJobLimit(3);
                else if (e.target.value === 'Reviewer') setJobLimit(18);
                else setJobLimit(30);
              }}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            >
              <option value="Preparer">Preparer</option>
              <option value="Reviewer">Reviewer</option>
              <option value="RI">RI</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Weekly Capacity (hours)
            </label>
            <input
              type="number"
              step="0.5"
              value={capacity}
              onChange={(e) => setCapacity(parseFloat(e.target.value) || 37.5)}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Concurrent Job Limit
            </label>
            <input
              type="number"
              value={jobLimit}
              onChange={(e) => setJobLimit(parseInt(e.target.value) || 3)}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Overtime Hours (per week)
            </label>
            <input
              type="number"
              step="0.5"
              value={overtimeHrs}
              onChange={(e) => setOvertimeHrs(parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isRI}
              onChange={(e) => setIsRI(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-slate-600">Eligible as Responsible Individual (RI)</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 border rounded-md hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
