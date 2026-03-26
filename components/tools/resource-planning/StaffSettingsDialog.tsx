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

  const [primaryRole, setPrimaryRole] = useState<'Specialist' | 'Preparer' | 'Reviewer' | 'RI'>(setting?.resourceRole ?? 'Preparer');
  const [capacity, setCapacity] = useState(setting?.weeklyCapacityHrs ?? 37.5);
  const [overtimeHrs, setOvertimeHrs] = useState(setting?.overtimeHrs ?? 0);

  // Per-role job limits (null = not eligible)
  const [specLimit, setSpecLimit] = useState<number | null>(setting?.specialistJobLimit ?? (setting?.resourceRole === 'Specialist' ? setting.concurrentJobLimit : null));
  const [prepLimit, setPrepLimit] = useState<number | null>(setting?.preparerJobLimit ?? (setting?.resourceRole === 'Preparer' ? setting.concurrentJobLimit : null));
  const [revLimit, setRevLimit] = useState<number | null>(setting?.reviewerJobLimit ?? (setting?.resourceRole === 'Reviewer' ? setting.concurrentJobLimit : null));
  const [riLimit, setRiLimit] = useState<number | null>(setting?.riJobLimit ?? (setting?.isRI || setting?.resourceRole === 'RI' ? (setting?.resourceRole === 'RI' ? setting.concurrentJobLimit : 5) : null));

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const defaultLimitForRole = primaryRole === 'Specialist' ? (specLimit ?? 5) : primaryRole === 'Preparer' ? (prepLimit ?? 3) : primaryRole === 'Reviewer' ? (revLimit ?? 18) : (riLimit ?? 30);
      const updates = {
        resourceRole: primaryRole,
        weeklyCapacityHrs: capacity,
        concurrentJobLimit: defaultLimitForRole,
        isRI: riLimit != null && riLimit > 0,
        specialistJobLimit: specLimit,
        preparerJobLimit: prepLimit,
        reviewerJobLimit: revLimit,
        riJobLimit: riLimit,
        overtimeHrs,
      };

      const res = await fetch(`/api/resource-planning/staff/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        updateStaffSetting(userId, updates as any);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[400px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">{member.name} - Settings</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Primary Role */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Primary Role</label>
            <select
              value={primaryRole}
              onChange={(e) => setPrimaryRole(e.target.value as any)}
              className="w-full px-2 py-1.5 text-sm border rounded-md"
            >
              <option value="Specialist">Specialist</option>
              <option value="Preparer">Preparer</option>
              <option value="Reviewer">Reviewer</option>
              <option value="RI">RI</option>
            </select>
          </div>

          {/* Per-role concurrent job limits */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Role Eligibility & Job Limits</label>
            <div className="space-y-1.5 bg-slate-50 rounded-md p-2">
              <RoleLimitRow
                label="Specialist"
                color="bg-teal-400"
                limit={specLimit}
                defaultLimit={5}
                onChange={setSpecLimit}
              />
              <RoleLimitRow
                label="Preparer"
                color="bg-blue-400"
                limit={prepLimit}
                defaultLimit={3}
                onChange={setPrepLimit}
              />
              <RoleLimitRow
                label="Reviewer"
                color="bg-purple-400"
                limit={revLimit}
                defaultLimit={18}
                onChange={setRevLimit}
              />
              <RoleLimitRow
                label="RI"
                color="bg-amber-400"
                limit={riLimit}
                defaultLimit={30}
                onChange={setRiLimit}
              />
            </div>
          </div>

          {/* Capacity */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Weekly Hours</label>
              <input
                type="number"
                step="0.5"
                value={capacity}
                onChange={(e) => setCapacity(parseFloat(e.target.value) || 37.5)}
                className="w-full px-2 py-1.5 text-sm border rounded-md"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Overtime Hours</label>
              <input
                type="number"
                step="0.5"
                value={overtimeHrs}
                onChange={(e) => setOvertimeHrs(parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1.5 text-sm border rounded-md"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 border rounded-md hover:bg-slate-50">
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

function RoleLimitRow({
  label,
  color,
  limit,
  defaultLimit,
  onChange,
}: {
  label: string;
  color: string;
  limit: number | null;
  defaultLimit: number;
  onChange: (v: number | null) => void;
}) {
  const enabled = limit != null;

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 cursor-pointer flex-1">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? defaultLimit : null)}
          className="h-3 w-3 rounded"
        />
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs text-slate-700">{label}</span>
      </label>
      {enabled && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400">Max jobs:</span>
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => onChange(parseInt(e.target.value) || 1)}
            className="w-12 px-1 py-0.5 text-xs border rounded text-center"
          />
        </div>
      )}
    </div>
  );
}
