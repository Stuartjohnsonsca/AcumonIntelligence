'use client';

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ResourceRole } from '@/lib/resource-planning/types';

interface Props {
  onClose: () => void;
}

const ROLES: ResourceRole[] = ['Specialist', 'RI', 'Reviewer', 'Preparer'];

export function RollForwardDialog({ onClose }: Props) {
  const jobs = useResourcePlanningStore((s) => s.jobs);
  const updateJob = useResourcePlanningStore((s) => s.updateJob);
  const setCompletedCount = useResourcePlanningStore((s) => s.setCompletedCount);
  const allocations = useResourcePlanningStore((s) => s.allocations);

  const completed = jobs.filter((j) => j.schedulingStatus === 'completed');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [hours, setHours] = useState({ specialist: 0, ri: 0, reviewer: 0, preparer: 0 });
  const [rollForwardMonths, setRollForwardMonths] = useState(12);
  const [saving, setSaving] = useState(false);

  const job = completed[currentIdx];

  useEffect(() => {
    if (job) {
      setHours({
        specialist: job.budgetHoursSpecialist,
        ri: job.budgetHoursRI,
        reviewer: job.budgetHoursReviewer,
        preparer: job.budgetHoursPreparer,
      });
    }
  }, [currentIdx, job?.id]);

  if (completed.length === 0) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30">
        <div className="bg-white rounded-lg shadow-xl w-[450px] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-800">Roll Forward</h3>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
          </div>
          <p className="text-sm text-slate-500 text-center py-8">No completed jobs to roll forward</p>
        </div>
      </div>
    );
  }

  // Get actual hours from the job (synced from CRM)
  const actualHours = job ? {
    specialist: job.actualHoursSpecialist,
    ri: job.actualHoursRI,
    reviewer: job.actualHoursReviewer,
    preparer: job.actualHoursPreparer,
  } : { specialist: 0, ri: 0, reviewer: 0, preparer: 0 };

  // Get staff from existing allocations for this job
  const jobAllocs = job ? allocations.filter((a) => a.engagementId === job.engagementId) : [];

  async function handleCommit() {
    if (!job) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/resource-planning/jobs/${job.id}/roll-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budgetHoursSpecialist: hours.specialist,
          budgetHoursRI: hours.ri,
          budgetHoursReviewer: hours.reviewer,
          budgetHoursPreparer: hours.preparer,
          rollForwardMonths,
        }),
      });

      if (res.ok) {
        setCompletedCount(completed.length - 1);
        if (currentIdx >= completed.length - 1) {
          setCurrentIdx(Math.max(0, currentIdx - 1));
        }
        // Refresh page to get new job
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!job) return;
    setSaving(true);
    try {
      await fetch(`/api/resource-planning/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedulingStatus: 'completed',
          budgetHoursSpecialist: hours.specialist,
          budgetHoursRI: hours.ri,
          budgetHoursReviewer: hours.reviewer,
          budgetHoursPreparer: hours.preparer,
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[550px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Roll Forward ({currentIdx + 1} of {completed.length})
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
            disabled={currentIdx === 0}
            className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <div className="text-base font-semibold text-slate-800">{job?.clientName}</div>
            <div className="text-xs text-slate-500">{job?.auditType} | Period End: {job ? new Date(job.periodEnd).toLocaleDateString() : ''}</div>
          </div>
          <button
            onClick={() => setCurrentIdx(Math.min(completed.length - 1, currentIdx + 1))}
            disabled={currentIdx >= completed.length - 1}
            className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Previous team */}
        {jobAllocs.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Previous Team</label>
            <div className="flex flex-wrap gap-1">
              {jobAllocs.map((a) => (
                <span key={a.id} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
                  {a.userName} ({a.role})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actual vs Budget hours comparison */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Hours Comparison (Actual vs Budget)</label>
          <div className="grid grid-cols-4 gap-2">
            {ROLES.map((role) => {
              const key = role.toLowerCase() as keyof typeof hours;
              const actual = actualHours[key];
              const budget = job ? {
                specialist: job.budgetHoursSpecialist,
                ri: job.budgetHoursRI,
                reviewer: job.budgetHoursReviewer,
                preparer: job.budgetHoursPreparer,
              }[key] : 0;
              const diff = actual - budget;
              return (
                <div key={role} className="text-center p-2 bg-slate-50 rounded">
                  <div className="text-[10px] font-medium text-slate-500">{role}</div>
                  <div className="text-xs">
                    <span className="font-medium">{actual}h</span>
                    <span className="text-slate-400"> / {budget}h</span>
                  </div>
                  {diff !== 0 && (
                    <div className={`text-[10px] ${diff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {diff > 0 ? '+' : ''}{diff}h
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Roll forward settings */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Roll Forward Period</label>
          <select
            value={rollForwardMonths}
            onChange={(e) => setRollForwardMonths(parseInt(e.target.value))}
            className="w-full px-2 py-1.5 text-sm border rounded-md"
          >
            <option value={6}>6 months (Semi-annual)</option>
            <option value={12}>12 months (Annual)</option>
            <option value={18}>18 months</option>
            <option value={24}>24 months (Biennial)</option>
          </select>
        </div>

        {/* New budget hours */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-slate-600 mb-1">New Period Budget Hours</label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { key: 'specialist', label: 'Specialist', color: 'text-teal-700' },
              { key: 'ri', label: 'RI', color: 'text-amber-700' },
              { key: 'reviewer', label: 'Reviewer', color: 'text-purple-700' },
              { key: 'preparer', label: 'Preparer', color: 'text-blue-700' },
            ].map(({ key, label, color }) => (
              <div key={key}>
                <label className={`block text-[10px] font-medium ${color} mb-0.5`}>{label}</label>
                <input
                  type="number"
                  value={hours[key as keyof typeof hours]}
                  onChange={(e) => setHours({ ...hours, [key]: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2 py-1 text-xs border rounded text-center"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 border rounded-md hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={handleCommit}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5" />
            {saving ? 'Committing...' : 'Commit Roll Forward'}
          </button>
        </div>
      </div>
    </div>
  );
}
