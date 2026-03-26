'use client';

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Wand2, Zap } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ResourceJobView, ResourceJobProfile, ResourceRole, ScheduleProposal } from '@/lib/resource-planning/types';

interface Props {
  onClose: () => void;
}

export function UnscheduledJobsDialog({ onClose }: Props) {
  const jobs = useResourcePlanningStore((s) => s.jobs);
  const jobProfiles = useResourcePlanningStore((s) => s.jobProfiles);
  const updateJob = useResourcePlanningStore((s) => s.updateJob);
  const setUnscheduledCount = useResourcePlanningStore((s) => s.setUnscheduledCount);

  const unscheduled = jobs.filter((j) => j.schedulingStatus === 'unscheduled');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [hours, setHours] = useState({ specialist: 0, ri: 0, reviewer: 0, preparer: 0 });
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);

  const job = unscheduled[currentIdx];

  useEffect(() => {
    if (job) {
      setHours({
        specialist: job.budgetHoursSpecialist,
        ri: job.budgetHoursRI,
        reviewer: job.budgetHoursReviewer,
        preparer: job.budgetHoursPreparer,
      });
      setStartDate(new Date().toISOString().split('T')[0]);
      setSelectedProfileId(job.jobProfileId ?? '');
    }
  }, [currentIdx, job?.id]);

  if (unscheduled.length === 0) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30">
        <div className="bg-white rounded-lg shadow-xl w-[450px] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-800">Unscheduled Jobs</h3>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
          </div>
          <p className="text-sm text-slate-500 text-center py-8">No unscheduled jobs</p>
        </div>
      </div>
    );
  }

  function applyProfile(profileId: string) {
    const profile = jobProfiles.find((p) => p.id === profileId);
    if (profile) {
      setHours({
        specialist: profile.budgetHoursSpecialist,
        ri: profile.budgetHoursRI,
        reviewer: profile.budgetHoursReviewer,
        preparer: profile.budgetHoursPreparer,
      });
    }
    setSelectedProfileId(profileId);
  }

  async function handleSchedule() {
    if (!job) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/resource-planning/jobs/${job.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          budgetHoursSpecialist: hours.specialist,
          budgetHoursRI: hours.ri,
          budgetHoursReviewer: hours.reviewer,
          budgetHoursPreparer: hours.preparer,
          jobProfileId: selectedProfileId || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setProposal(data.proposal);
        setShowConfirm(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleScheduleAll() {
    setSaving(true);
    try {
      const res = await fetch('/api/resource-planning/jobs/schedule-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        // Refresh the page data
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCommit() {
    if (!job || !proposal) return;
    setSaving(true);
    try {
      // Create allocations from proposal
      for (const alloc of proposal.allocations) {
        await fetch('/api/resource-planning/allocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engagementId: job.engagementId,
            userId: alloc.userId,
            role: alloc.role,
            startDate: alloc.startDate,
            endDate: alloc.endDate,
            hoursPerDay: alloc.hoursPerDay,
            totalHours: alloc.totalHours,
          }),
        });
      }

      // Update job status
      await fetch(`/api/resource-planning/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedulingStatus: 'scheduled' }),
      });

      updateJob(job.id, { schedulingStatus: 'scheduled' });
      setUnscheduledCount(unscheduled.length - 1);
      setShowConfirm(false);
      setProposal(null);

      if (currentIdx >= unscheduled.length - 1) {
        setCurrentIdx(Math.max(0, currentIdx - 1));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePreSchedule() {
    if (!job) return;
    setSaving(true);
    try {
      await fetch(`/api/resource-planning/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedulingStatus: 'pre_scheduled',
          budgetHoursSpecialist: hours.specialist,
          budgetHoursRI: hours.ri,
          budgetHoursReviewer: hours.reviewer,
          budgetHoursPreparer: hours.preparer,
          jobProfileId: selectedProfileId || null,
        }),
      });
      updateJob(job.id, { schedulingStatus: 'pre_scheduled' as any });
      setShowConfirm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[520px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Unscheduled Jobs ({currentIdx + 1} of {unscheduled.length})
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
        </div>

        {!showConfirm ? (
          <>
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
                <div className="text-xs text-slate-500">{job?.auditType}</div>
              </div>
              <button
                onClick={() => setCurrentIdx(Math.min(unscheduled.length - 1, currentIdx + 1))}
                disabled={currentIdx >= unscheduled.length - 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Job details */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
              <div>
                <label className="text-slate-500">Period End</label>
                <div className="font-medium">{job ? new Date(job.periodEnd).toLocaleDateString() : '—'}</div>
              </div>
              <div>
                <label className="text-slate-500">Target Completion</label>
                <div className="font-medium text-amber-700">
                  {job?.customDeadline ? new Date(job.customDeadline).toLocaleDateString() : job ? new Date(job.targetCompletion).toLocaleDateString() : '—'}
                </div>
              </div>
              <div>
                <label className="text-slate-500">Compliance Deadline</label>
                <div className="font-medium text-red-700">
                  {job?.complianceDeadline ? new Date(job.complianceDeadline).toLocaleDateString() : '—'}
                </div>
              </div>
              <div>
                <label className="text-slate-500">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>
            </div>

            {/* Job Resource Profile */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">Job Resource Profile</label>
              <select
                value={selectedProfileId}
                onChange={(e) => applyProfile(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border rounded-md"
              >
                <option value="">Select profile...</option>
                {jobProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Budget hours */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              {[
                { key: 'specialist', label: 'Specialist', color: 'text-teal-700' },
                { key: 'ri', label: 'RI', color: 'text-amber-700' },
                { key: 'reviewer', label: 'Reviewer', color: 'text-purple-700' },
                { key: 'preparer', label: 'Preparer', color: 'text-blue-700' },
              ].map(({ key, label, color }) => (
                <div key={key}>
                  <label className={`block text-[10px] font-medium ${color} mb-0.5`}>{label} Hrs</label>
                  <input
                    type="number"
                    value={hours[key as keyof typeof hours]}
                    onChange={(e) => setHours({ ...hours, [key]: parseFloat(e.target.value) || 0 })}
                    className="w-full px-2 py-1 text-xs border rounded text-center"
                  />
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              <button
                onClick={handleScheduleAll}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-md hover:bg-indigo-100 disabled:opacity-50"
              >
                <Zap className="h-3.5 w-3.5" />
                Schedule All
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 border rounded-md hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={handleSchedule}
                  disabled={saving || !startDate}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {saving ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Schedule Confirmation */
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-3">Proposed Schedule for {job?.clientName}</h4>
            {proposal?.allocations.map((alloc, i) => (
              <div key={i} className="flex items-center gap-3 mb-2 p-2 bg-slate-50 rounded">
                <span className="text-xs font-medium w-16">{alloc.role}</span>
                <span className="text-xs flex-1">{alloc.userName}</span>
                <span className="text-xs text-slate-500">
                  {new Date(alloc.startDate).toLocaleDateString()} – {new Date(alloc.endDate).toLocaleDateString()}
                </span>
                <span className="text-xs font-medium">{alloc.totalHours}h</span>
                <span className={`text-[10px] px-1 rounded ${alloc.availabilityScore >= 50 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {alloc.availabilityScore}%
                </span>
              </div>
            ))}
            {proposal?.conflicts.map((c, i) => (
              <div key={i} className="text-xs text-red-600 mb-1">⚠ {c}</div>
            ))}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowConfirm(false); setProposal(null); }}
                className="px-3 py-1.5 text-xs text-slate-600 border rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePreSchedule}
                disabled={saving}
                className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={handleCommit}
                disabled={saving}
                className="px-3 py-1.5 text-xs text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Committing...' : 'Commit'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
