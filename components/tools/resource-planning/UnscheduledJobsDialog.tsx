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

  // Filter to audit/assurance jobs only (not all 400+)
  const AUDIT_TYPES = ['SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS', 'GROUP'];
  const unscheduled = jobs.filter((j) => j.schedulingStatus === 'unscheduled' && AUDIT_TYPES.includes(j.auditType));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [hours, setHours] = useState({ specialist: 0, ri: 0, reviewer: 0, preparer: 0 });
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'single' | 'list'>('list');

  // Clamp index when list shrinks
  useEffect(() => {
    if (unscheduled.length > 0 && currentIdx >= unscheduled.length) {
      setCurrentIdx(unscheduled.length - 1);
    }
  }, [unscheduled.length, currentIdx]);

  const job = unscheduled[currentIdx];

  useEffect(() => {
    if (job) {
      // Determine which profile to use: explicit jobProfileId > serviceType match > none
      let profileId = job.jobProfileId ?? '';
      if (!profileId && job.serviceType) {
        const match = jobProfiles.find(
          (p) => p.name.toLowerCase() === job.serviceType!.toLowerCase()
        );
        if (match) profileId = match.id;
      }
      const profile = jobProfiles.find((p) => p.id === profileId);
      setSelectedProfileId(profileId);
      setHours({
        specialist: profile?.budgetHoursSpecialist ?? job.budgetHoursSpecialist,
        ri: profile?.budgetHoursRI ?? job.budgetHoursRI,
        reviewer: profile?.budgetHoursReviewer ?? job.budgetHoursReviewer,
        preparer: profile?.budgetHoursPreparer ?? job.budgetHoursPreparer,
      });
      setStartDate(new Date().toISOString().split('T')[0]);
    }
  }, [currentIdx, job?.id, jobProfiles]);

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

  function toggleJobSelection(jobId: string) {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  }

  function selectAll() { setSelectedJobIds(new Set(unscheduled.map(j => j.id))); }
  function deselectAll() { setSelectedJobIds(new Set()); }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[620px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-800">
              Unscheduled Jobs ({unscheduled.length})
            </h3>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => setViewMode('list')}
                className={`px-2 py-1 text-[10px] ${viewMode === 'list' ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>List</button>
              <button onClick={() => setViewMode('single')}
                className={`px-2 py-1 text-[10px] ${viewMode === 'single' ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>Detail</button>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="h-4 w-4" /></button>
        </div>

        {viewMode === 'list' && !showConfirm ? (
          <div className="flex-1 overflow-y-auto p-4">
            {/* Batch actions */}
            <div className="flex items-center gap-2 mb-3 text-xs">
              <button onClick={selectAll} className="text-blue-600 hover:text-blue-800">Select All</button>
              <button onClick={deselectAll} className="text-slate-500 hover:text-slate-700">Deselect All</button>
              <span className="text-slate-400 ml-auto">{selectedJobIds.size} selected</span>
            </div>

            {/* Job list with checkboxes */}
            <div className="space-y-1 max-h-[45vh] overflow-y-auto">
              {unscheduled.map((j, idx) => (
                <div key={j.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  selectedJobIds.has(j.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:border-slate-200'
                }`} onClick={() => toggleJobSelection(j.id)}>
                  <input type="checkbox" checked={selectedJobIds.has(j.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleJobSelection(j.id)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{j.clientName}</div>
                    <div className="text-[10px] text-slate-400">{j.auditType} • PE: {new Date(j.periodEnd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-amber-700">{new Date(j.targetCompletion).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                    {j.budgetHoursPreparer > 0 && <div className="text-[9px] text-slate-400">{j.budgetHoursPreparer}h</div>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setCurrentIdx(idx); setViewMode('single'); }}
                    className="text-[10px] text-indigo-500 hover:text-indigo-700 px-2 py-1 rounded hover:bg-indigo-50">
                    Detail
                  </button>
                </div>
              ))}
            </div>

            {/* Batch schedule button */}
            <div className="flex justify-between mt-4 pt-3 border-t">
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 border rounded-md hover:bg-slate-50">Close</button>
              <button
                onClick={handleScheduleAll}
                disabled={saving || selectedJobIds.size === 0}
                className="flex items-center gap-1 px-4 py-1.5 text-xs text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                <Zap className="h-3.5 w-3.5" />
                {saving ? 'Scheduling...' : `Schedule ${selectedJobIds.size} Selected`}
              </button>
            </div>
          </div>
        ) : !showConfirm ? (
          <div className="p-4">
            {/* Single job detail view */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))} disabled={currentIdx === 0}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="text-center">
                <div className="text-base font-semibold text-slate-800">{job?.clientName}</div>
                <div className="text-xs text-slate-500">{job?.auditType} • {currentIdx + 1} of {unscheduled.length}</div>
              </div>
              <button onClick={() => setCurrentIdx(Math.min(unscheduled.length - 1, currentIdx + 1))}
                disabled={currentIdx >= unscheduled.length - 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
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
              <button onClick={() => setViewMode('list')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 border rounded-md hover:bg-slate-50">
                ← Back to List
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
          </div>
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
