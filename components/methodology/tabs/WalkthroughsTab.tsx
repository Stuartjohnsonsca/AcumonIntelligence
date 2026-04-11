'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, CheckCircle2, Plus, Trash2, Send, Video, MapPin, MessageSquare, Loader2, ChevronDown, ChevronRight, Upload, Eye, X, AlertTriangle, Edit3 } from 'lucide-react';
import { WalkthroughFlowEditor } from '../WalkthroughFlowEditor';
import { DocumentAnnotator } from '../panels/DocumentAnnotator';
import { expandZipFile } from '@/lib/client-unzip';

// ─── Types ───
interface ProcessTab { key: string; label: string; children?: ProcessTab[]; }
interface Control { description: string; type: string; frequency: string; tested: boolean; }
interface FlowStep {
  id: string; label: string; type: 'start' | 'action' | 'decision' | 'end'; next: string[]; condition?: string;
  sourceDoc?: string; outputDoc?: string; responsible?: string; docLocation?: string; isSignificantControl?: boolean;
  approvalChain?: { level: number; role: string; threshold?: string }[];
  attachments?: { id: string; name: string; storagePath: string }[];
  stepSignOffs?: { preparer?: { name: string; at: string; status: 'blank' | 'red' | 'green' }; reviewer?: { name: string; at: string; status: 'blank' | 'red' | 'green' }; ri?: { name: string; at: string; status: 'blank' | 'red' | 'green' } };
}
interface ProcessStatus {
  stage: 'draft' | 'requested' | 'received' | 'flowchart_generated' | 'sent_for_verification' | 'verified' | 'scheduling' | 'walkthrough_in_progress' | 'complete';
  portalRequestId?: string;
  verificationRequestId?: string;
  schedulingMethod?: 'teams' | 'onsite' | 'message';
  flowchart?: FlowStep[];
  flowchartConfirmedAt?: string;
  flowchartEditedAfterConfirm?: boolean;
  evidence?: { id: string; name: string; type: string; storagePath?: string; annotations?: { x: number; y: number }[] }[];
  signOffs?: { preparer?: { name: string; at: string }; reviewer?: { name: string; at: string }; ri?: { name: string; at: string } };
}

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft', requested: 'Requested from Client', received: 'Documentation Received',
  flowchart_generated: 'Flowchart Generated', sent_for_verification: 'Sent for Verification',
  verified: 'Client Verified', scheduling: 'Scheduling Walkthrough',
  walkthrough_in_progress: 'Walkthrough In Progress', complete: 'Complete',
};

const STAGE_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', requested: 'bg-amber-100 text-amber-700', received: 'bg-blue-100 text-blue-700',
  flowchart_generated: 'bg-purple-100 text-purple-700', sent_for_verification: 'bg-orange-100 text-orange-700',
  verified: 'bg-green-100 text-green-700', scheduling: 'bg-cyan-100 text-cyan-700',
  walkthrough_in_progress: 'bg-indigo-100 text-indigo-700', complete: 'bg-green-200 text-green-800',
};

interface Props { engagementId: string; userRole?: string; }

export function WalkthroughsTab({ engagementId, userRole }: Props) {
  const [processes, setProcesses] = useState<ProcessTab[]>([
    { key: 'sales', label: 'Sales Process' },
    { key: 'purchases', label: 'Purchase Process' },
  ]);
  const [activeTab, setActiveTab] = useState('sales');
  const [activeSubProcess, setActiveSubProcess] = useState<string | null>(null);
  const [newProcessName, setNewProcessName] = useState('');
  const [showAddProcess, setShowAddProcess] = useState(false);
  const [showAddSubProcess, setShowAddSubProcess] = useState(false);
  const [newSubProcessName, setNewSubProcessName] = useState('');
  const [allStatuses, setAllStatuses] = useState<Record<string, ProcessStatus>>({});

  // Load custom processes and all statuses from permanent file
  useEffect(() => {
    fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_processes`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const procs = data?.data?.processes || data?.answers?.processes;
        if (procs?.length > 0) setProcesses(procs);
      }).catch(() => {});
  }, [engagementId]);

  // Flatten process tree to get all keys (parents + children)
  function getAllProcessKeys(procs: ProcessTab[]): { key: string }[] {
    const keys: { key: string }[] = [];
    for (const p of procs) {
      keys.push({ key: p.key });
      if (p.children) for (const c of p.children) keys.push({ key: c.key });
    }
    return keys;
  }

  // Load all process statuses for overall sign-off calculation
  useEffect(() => {
    if (processes.length === 0) return;
    const allKeys = getAllProcessKeys(processes);
    Promise.all(allKeys.map(p =>
      fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_${p.key}_status`)
        .then(r => r.ok ? r.json() : null)
        .then(data => ({ key: p.key, status: data?.data || data?.answers || {} }))
        .catch(() => ({ key: p.key, status: {} }))
    )).then(results => {
      const map: Record<string, ProcessStatus> = {};
      for (const r of results) map[r.key] = r.status;
      setAllStatuses(map);
    });
  }, [engagementId, processes]);

  // Callback from child process to update allStatuses
  function onProcessStatusChange(key: string, newStatus: ProcessStatus) {
    setAllStatuses(prev => ({ ...prev, [key]: newStatus }));
  }

  // Overall walkthrough sign-off (tab level) — clicked by Reviewer/RI
  const [overallSignOffs, setOverallSignOffs] = useState<{ reviewer?: { name: string; at: string }; ri?: { name: string; at: string } }>({});

  useEffect(() => {
    fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_overall_signoffs`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { const d = data?.data || data?.answers; if (d) setOverallSignOffs(d); })
      .catch(() => {});
  }, [engagementId]);

  function toggleOverallSignOff(role: 'reviewer' | 'ri') {
    const current = overallSignOffs[role];
    const updated = { ...overallSignOffs, [role]: current ? undefined : { name: 'Current User', at: new Date().toISOString() } };
    setOverallSignOffs(updated);
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: 'walkthrough_overall_signoffs', data: updated }),
    }).catch(() => {});
  }

  function addProcess() {
    if (!newProcessName.trim()) return;
    const key = newProcessName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (processes.find(p => p.key === key)) return;
    const updated = [...processes, { key, label: newProcessName.trim() }];
    setProcesses(updated);
    setNewProcessName('');
    setShowAddProcess(false);
    setActiveTab(key);
    // Persist
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: 'walkthrough_processes', data: { processes: updated } }),
    }).catch(() => {});
  }

  function removeProcess(key: string) {
    if (processes.length <= 1) return;
    const updated = processes.filter(p => p.key !== key);
    setProcesses(updated);
    if (activeTab === key) { setActiveTab(updated[0].key); setActiveSubProcess(null); }
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: 'walkthrough_processes', data: { processes: updated } }),
    }).catch(() => {});
  }

  function addSubProcess() {
    if (!newSubProcessName.trim()) return;
    const childKey = `${activeTab}_${newSubProcessName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
    const parent = processes.find(p => p.key === activeTab);
    if (!parent) return;
    if (parent.children?.find(c => c.key === childKey)) return;
    const updated = processes.map(p =>
      p.key === activeTab ? { ...p, children: [...(p.children || []), { key: childKey, label: newSubProcessName.trim() }] } : p
    );
    setProcesses(updated);
    setNewSubProcessName('');
    setShowAddSubProcess(false);
    setActiveSubProcess(childKey);
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: 'walkthrough_processes', data: { processes: updated } }),
    }).catch(() => {});
  }

  function removeSubProcess(parentKey: string, childKey: string) {
    const updated = processes.map(p =>
      p.key === parentKey ? { ...p, children: (p.children || []).filter(c => c.key !== childKey) } : p
    );
    setProcesses(updated);
    if (activeSubProcess === childKey) setActiveSubProcess(null);
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: 'walkthrough_processes', data: { processes: updated } }),
    }).catch(() => {});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Walkthroughs</h2>
          <p className="text-xs text-slate-400">Document business processes, generate flowcharts, and perform walkthrough testing</p>
        </div>
        {/* Overall Reviewer/RI dots — clickable sign-off for entire Walkthroughs tab */}
        <div className="flex items-center gap-3">
          <button onClick={() => toggleOverallSignOff('reviewer')} className="flex items-center gap-1" title={overallSignOffs.reviewer ? `Reviewed by ${overallSignOffs.reviewer.name} — click to unsign` : 'Click to sign off as Reviewer'}>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${overallSignOffs.reviewer ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
              {overallSignOffs.reviewer && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            <span className="text-[9px] font-bold text-slate-500">Reviewer</span>
          </button>
          <button onClick={() => toggleOverallSignOff('ri')} className="flex items-center gap-1" title={overallSignOffs.ri ? `RI signed by ${overallSignOffs.ri.name} — click to unsign` : 'Click to sign off as RI'}>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${overallSignOffs.ri ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
              {overallSignOffs.ri && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            <span className="text-[9px] font-bold text-slate-500">RI</span>
          </button>
        </div>
      </div>

      {/* Process tabs (top row) */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
        {processes.map(tab => (
          <div key={tab.key} className="relative group">
            <button
              onClick={() => { setActiveTab(tab.key); setActiveSubProcess(null); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.children && tab.children.length > 0 && <span className="ml-1 text-[9px] text-slate-400">▾</span>}
            </button>
            {processes.length > 1 && (
              <button onClick={() => removeProcess(tab.key)} className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] leading-none hidden group-hover:flex items-center justify-center">×</button>
            )}
          </div>
        ))}
        {showAddProcess ? (
          <div className="flex items-center gap-1 ml-1">
            <input type="text" value={newProcessName} onChange={e => setNewProcessName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addProcess()}
              className="px-2 py-1 text-xs border rounded w-32 focus:outline-none focus:border-blue-400" placeholder="Process name..." autoFocus />
            <button onClick={addProcess} disabled={!newProcessName.trim()} className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50">Add</button>
            <button onClick={() => { setShowAddProcess(false); setNewProcessName(''); }} className="px-1 py-1 text-xs text-slate-400">✕</button>
          </div>
        ) : (
          <button onClick={() => setShowAddProcess(true)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-blue-600 transition-colors" title="Add process">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Sub-process tabs (second row) — shown when active process has children or adding */}
      {(() => {
        const activeProcess = processes.find(p => p.key === activeTab);
        const children = activeProcess?.children || [];
        if (children.length === 0 && !showAddSubProcess) {
          // Show just the ⊕ button to start adding sub-processes
          return (
            <div className="flex items-center gap-1 ml-4">
              <button onClick={() => setShowAddSubProcess(true)} className="px-2 py-1 text-[10px] text-slate-400 hover:text-blue-600 border border-dashed border-slate-300 rounded-md transition-colors inline-flex items-center gap-1" title="Add sub-process">
                <Plus className="h-3 w-3" /> Sub-process
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1 ml-4 bg-slate-50 rounded-lg p-0.5">
            {/* Parent process tab (always first) */}
            <button
              onClick={() => setActiveSubProcess(null)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                activeSubProcess === null ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {activeProcess?.label || activeTab}
            </button>
            <span className="text-slate-300 text-[10px]">│</span>
            {children.map(child => (
              <div key={child.key} className="relative group">
                <button
                  onClick={() => setActiveSubProcess(child.key)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                    activeSubProcess === child.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {child.label}
                </button>
                <button onClick={() => removeSubProcess(activeTab, child.key)} className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 text-white rounded-full text-[7px] leading-none hidden group-hover:flex items-center justify-center">×</button>
              </div>
            ))}
            {showAddSubProcess ? (
              <div className="flex items-center gap-1 ml-1">
                <input type="text" value={newSubProcessName} onChange={e => setNewSubProcessName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSubProcess()}
                  className="px-1.5 py-0.5 text-[10px] border rounded w-28 focus:outline-none focus:border-blue-400" placeholder="Sub-process..." autoFocus />
                <button onClick={addSubProcess} disabled={!newSubProcessName.trim()} className="px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded disabled:opacity-50">Add</button>
                <button onClick={() => { setShowAddSubProcess(false); setNewSubProcessName(''); }} className="px-1 py-0.5 text-[10px] text-slate-400">✕</button>
              </div>
            ) : (
              <button onClick={() => setShowAddSubProcess(true)} className="px-1.5 py-1 text-slate-400 hover:text-blue-600 transition-colors" title="Add sub-process">
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })()}

      {/* Active process/sub-process content */}
      {(() => {
        const activeKey = activeSubProcess || activeTab;
        const activeProcess = processes.find(p => p.key === activeTab);
        const activeLabel = activeSubProcess
          ? activeProcess?.children?.find(c => c.key === activeSubProcess)?.label || activeSubProcess
          : activeProcess?.label || activeTab;
        return (
          <WalkthroughProcess key={activeKey} engagementId={engagementId} processKey={activeKey} processLabel={activeLabel} userRole={userRole} onStatusChange={(s) => onProcessStatusChange(activeKey, s)} />
        );
      })()}
    </div>
  );
}

// ─── Single Process Walkthrough ───
function WalkthroughProcess({ engagementId, processKey, processLabel, userRole, onStatusChange }: { engagementId: string; processKey: string; processLabel: string; userRole?: string; onStatusChange?: (s: ProcessStatus) => void }) {
  const [narrative, setNarrative] = useState('');
  const [controls, setControls] = useState<Control[]>([]);
  const [status, setStatus] = useState<ProcessStatus>({ stage: 'draft' });
  const [saving, setSaving] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<Set<string>>(new Set());
  const [annotatingEvidenceId, setAnnotatingEvidenceId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [showTeamsModal, setShowTeamsModal] = useState(false);
  const [teamsMeetings, setTeamsMeetings] = useState<any[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [importingMeeting, setImportingMeeting] = useState<string | null>(null);
  const [schedulingTeams, setSchedulingTeams] = useState(false);
  const [newMeetingDate, setNewMeetingDate] = useState('');
  const [newMeetingTime, setNewMeetingTime] = useState('10:00');
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({ narrative: true, controls: true, flowchart: true, evidence: true });

  // Load data + fetch portal uploads in one chain (avoids race condition)
  useEffect(() => {
    const uploadsUrl = showAllDocs
      ? `/api/portal/upload?engagementId=${engagementId}`
      : `/api/portal/upload?engagementId=${engagementId}&section=walkthroughs`;
    Promise.all([
      fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_${processKey}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_${processKey}_status`).then(r => r.ok ? r.json() : null),
      fetch(uploadsUrl).then(r => r.ok ? r.json() : null),
    ]).then(([content, statusData, uploadsData]) => {
      const answers = content?.data || content?.answers || {};
      setNarrative(answers.narrative || '');
      setControls(answers.controls || []);

      const st = statusData?.data || statusData?.answers || {};
      if (st.stage) {
        const verifiedStages = ['verified', 'scheduling', 'walkthrough_in_progress', 'complete'];
        if (verifiedStages.includes(st.stage) && st.flowchart?.length && !st.flowchartConfirmedAt) {
          st.flowchartConfirmedAt = new Date().toISOString();
          st.flowchartEditedAfterConfirm = false;
        }
      }

      // Merge portal uploads into evidence in-memory (don't save yet — user actions trigger saves)
      const uploads = uploadsData?.uploads || [];
      const existingEvidence: any[] = st.evidence || [];
      if (uploads.length > 0) {
        const existingPaths = new Set(existingEvidence.map((e: any) => e.storagePath).filter(Boolean));
        const existingIds = new Set(existingEvidence.map((e: any) => e.id));
        const newFromUploads = uploads
          .filter((u: any) => !existingIds.has(u.id) && !existingPaths.has(u.storagePath))
          .map((u: any) => ({ id: u.id, name: u.originalName, type: u.mimeType || 'application/octet-stream', storagePath: u.storagePath }));
        st.evidence = [...existingEvidence, ...newFromUploads];
      }

      // Always ensure a valid stage
      if (!st.stage) st.stage = 'draft';
      setStatus(st);
    }).catch(() => {});
  }, [engagementId, processKey, showAllDocs]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/engagements/${engagementId}/permanent-file`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey: `walkthrough_${processKey}`, data: { narrative, controls } }),
      });
    } catch {} finally { setSaving(false); }
  }, [engagementId, processKey, narrative, controls]);

  async function saveStatus(newStatus: Partial<ProcessStatus>) {
    const updated = { ...status, ...newStatus };
    setStatus(updated);
    onStatusChange?.(updated);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/permanent-file`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey: `walkthrough_${processKey}_status`, data: updated }),
      });
      if (!res.ok) console.error('[Walkthrough] saveStatus failed:', res.status, await res.text().catch(() => ''));
    } catch (err) {
      console.error('[Walkthrough] saveStatus error:', err);
    }
  }

  // Request documentation from client
  async function requestFromClient() {
    setRequesting(true);
    try {
      // Save narrative first so it persists
      await save();

      const requestBody = {
        section: 'walkthroughs',
        title: `${processLabel} — Documentation Request`,
        question: `[Walkthrough: ${processLabel}] Please provide your ${processLabel.toLowerCase()} documentation. This can be:\n• Process maps or flowcharts\n• Procedure manuals\n• A written description of the process from start to finish\n\nPlease upload files or type your description below.`,
      };
      console.log('[Walkthrough] Sending request:', { engagementId, processKey, requestBody });
      const res = await fetch(`/api/engagements/${engagementId}/walkthrough-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      console.log('[Walkthrough] Response:', { status: res.status, data });
      if (res.ok) {
        await saveStatus({ stage: 'requested', portalRequestId: data.id });
        console.log('[Walkthrough] Status saved as requested, portalRequestId:', data.id);
      } else {
        console.error('[Walkthrough] Request failed:', data);
        alert(`Request failed: ${data.error || res.status}`);
      }
    } catch (err) {
      console.error('[Walkthrough] Request error:', err);
    } finally { setRequesting(false); }
  }

  // Generate flowchart from narrative text
  async function generateFlowchart() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/walkthrough-flowchart`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processKey, processLabel, narrative, controls }),
      });
      if (res.ok) {
        const data = await res.json();
        await saveStatus({ stage: 'flowchart_generated', flowchart: data.steps || [] });
      }
    } catch {} finally { setGenerating(false); }
  }

  // Analyse selected evidence documents, extract text, and generate flowchart
  async function analyseAndGenerate() {
    // Confirm if replacing existing flowchart
    if (status.flowchart && status.flowchart.length > 0) {
      if (!window.confirm('This will replace the current flowchart. Are you sure you wish to replace it?')) return;
    }
    setAnalysing(true);
    try {
      const evidenceFiles = (status.evidence || [])
        .filter(e => e.storagePath && selectedEvidence.has(e.id))
        .map(e => ({ storagePath: e.storagePath!, name: e.name, mimeType: e.type }));
      if (evidenceFiles.length === 0) { alert('Please select at least one document to analyse.'); setAnalysing(false); return; }

      const res = await fetch(`/api/engagements/${engagementId}/walkthrough-flowchart`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processKey, processLabel, narrative, controls, evidenceFiles }),
      });
      if (res.ok) {
        const data = await res.json();
        // If extracted narrative was returned, update the narrative field
        if (data.extractedNarrative) {
          setNarrative(prev => prev ? `${prev}\n\n--- Extracted from documents ---\n${data.extractedNarrative}` : data.extractedNarrative);
          await save();
        }
        await saveStatus({ stage: 'flowchart_generated', flowchart: data.steps || [] });
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        alert(`Analysis failed: ${err.error || res.status}`);
      }
    } catch (err) {
      console.error('[Walkthrough] Analyse error:', err);
    } finally { setAnalysing(false); }
  }

  // Fetch recent Teams meetings for import
  async function fetchTeamsMeetings() {
    setTeamsLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/meetings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_teams' }),
      });
      if (res.ok) { const data = await res.json(); setTeamsMeetings(data.meetings || []); }
    } catch {} finally { setTeamsLoading(false); }
  }

  // Import a Teams meeting, get transcript, summarise into narrative
  async function importTeamsMeeting(meeting: any) {
    setImportingMeeting(meeting.id);
    try {
      // Import the meeting + transcript
      const res = await fetch(`/api/engagements/${engagementId}/meetings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_teams', meeting }),
      });
      if (!res.ok) { alert('Failed to import meeting'); return; }
      const data = await res.json();

      // Summarise transcript into process narrative
      if (data.meeting?.transcriptRaw) {
        const sumRes = await fetch(`/api/engagements/${engagementId}/walkthrough-flowchart`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'summarise_transcript', transcript: data.meeting.transcriptRaw, processLabel }),
        });
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          if (sumData.narrative) {
            setNarrative(prev => prev ? `${prev}\n\n--- From Teams call: ${meeting.subject || 'Walkthrough'} ---\n${sumData.narrative}` : sumData.narrative);
            await save();
          }
        }
      }
      setShowTeamsModal(false);
    } catch (err) {
      console.error('[Walkthrough] Import Teams meeting error:', err);
    } finally { setImportingMeeting(null); }
  }

  // Schedule a new Teams meeting
  async function scheduleTeamsMeeting() {
    if (!newMeetingDate) { alert('Please select a date'); return; }
    setSchedulingTeams(true);
    try {
      const startDateTime = `${newMeetingDate}T${newMeetingTime}:00`;
      const res = await fetch(`/api/engagements/${engagementId}/meetings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_teams', subject: `${processLabel} — Walkthrough`, startDateTime, durationMinutes: 60 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.meeting?.joinUrl) window.open(data.meeting.joinUrl, '_blank');
        await saveStatus({ stage: 'walkthrough_in_progress', schedulingMethod: 'teams' });
        setShowTeamsModal(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to create meeting: ${err.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('[Walkthrough] Schedule Teams meeting error:', err);
    } finally { setSchedulingTeams(false); }
  }

  // Send flowchart for client verification
  async function sendForVerification() {
    try {
      const flowSummary = (status.flowchart || []).map((s, i) => `${i + 1}. [${s.type}] ${s.label}`).join('\n');

      const res = await fetch(`/api/engagements/${engagementId}/walkthrough-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'walkthroughs',
          question: `[Walkthrough Verification: ${processLabel}] Please verify this process flowchart is accurate. Reply Yes to confirm, or describe corrections / upload a corrected file.\n\n${flowSummary}`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await saveStatus({ stage: 'sent_for_verification', verificationRequestId: data.id });
      }
    } catch {}
  }

  // Schedule walkthrough
  async function scheduleWalkthrough(method: 'teams' | 'onsite' | 'message') {
    try {
      const messages: Record<string, string> = {
        teams: `Please schedule a Microsoft Teams meeting to perform a walkthrough of your ${processLabel.toLowerCase()}. We will need to speak with the person(s) responsible for this process.`,
        onsite: `We would like to arrange an on-site visit to perform a walkthrough of your ${processLabel.toLowerCase()}. Please advise when would be convenient and who should be available.`,
        message: `We will be performing a walkthrough of your ${processLabel.toLowerCase()} via message exchange. We will be asking for specific evidence supporting each step of the process. Please respond to each request below.`,
      };

      await fetch(`/api/engagements/${engagementId}/walkthrough-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'walkthroughs',
          question: `[Walkthrough: ${processLabel}] ${messages[method]}`,
        }),
      });

      await saveStatus({ stage: 'walkthrough_in_progress', schedulingMethod: method });
    } catch {}
  }

  // Sign-off
  function toggleSignOff(role: 'preparer' | 'reviewer' | 'ri') {
    const current = status.signOffs?.[role];
    const updated = current ? undefined : { name: 'Current User', at: new Date().toISOString() };
    saveStatus({ signOffs: { ...status.signOffs, [role]: updated } });
  }

  function toggleSection(key: string) { setSectionOpen(prev => ({ ...prev, [key]: !prev[key] })); }

  const stage = status.stage || 'draft';

  return (
    <div className="space-y-3">
      {/* Stage bar + sign-off dots */}
      <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[stage] || 'bg-slate-100 text-slate-600'}`}>
            {STAGE_LABELS[stage] || stage}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {(['preparer', 'reviewer', 'ri'] as const).map(role => {
            const so = status.signOffs?.[role];
            return (
              <button key={role} onClick={() => toggleSignOff(role)} className="flex items-center gap-1" title={so ? `${so.name} — click to unsign` : `Click to sign as ${role}`}>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${so ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'}`}>
                  {so && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                </div>
                <span className="text-[8px] text-slate-500 capitalize">{role === 'ri' ? 'RI' : role}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action buttons based on flowchart state */}
      {(() => {
        const hasFlowchart = status.flowchart && status.flowchart.length > 0;
        const isConfirmed = !!status.flowchartConfirmedAt && !status.flowchartEditedAfterConfirm;
        const needsReconfirm = !!status.flowchartConfirmedAt && status.flowchartEditedAfterConfirm;

        return (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Documentation methods — visible until flowchart exists */}
            {!hasFlowchart && (
              <div className="flex flex-col gap-2 w-full">
                <p className="text-[10px] text-slate-500 font-medium">How would you like to document this process?</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Type description + generate */}
                  {narrative.trim() && (stage === 'draft' || stage === 'received') && (
                    <button onClick={generateFlowchart} disabled={generating} className="text-[10px] px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1">
                      {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} Generate Flowchart from Description
                    </button>
                  )}
                  {/* Teams call */}
                  <button onClick={() => setShowTeamsModal(true)} className="text-[10px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 inline-flex items-center gap-1">
                    <Video className="h-3 w-3" /> Teams Call
                  </button>
                  {/* Request from client */}
                  {stage === 'draft' && (
                    <button onClick={requestFromClient} disabled={requesting || !narrative.trim()} className="text-[10px] px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1">
                      <Send className="h-3 w-3" /> {requesting ? 'Sending...' : 'Request from Client'}
                    </button>
                  )}
                  {stage === 'requested' && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">Awaiting client response...</span>
                  )}
                </div>
              </div>
            )}

            {/* Send to Client to Confirm — once flowchart exists and not yet confirmed (or edited after confirm) */}
            {hasFlowchart && (!isConfirmed || needsReconfirm) && stage !== 'walkthrough_in_progress' && stage !== 'complete' && (
              <>
                <button onClick={sendForVerification} className="text-[10px] px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 inline-flex items-center gap-1">
                  <Send className="h-3 w-3" /> Send to Client to Confirm
                </button>
                {needsReconfirm && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200 inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Flowchart edited since last confirmation
                  </span>
                )}
                {stage === 'sent_for_verification' && (
                  <span className="text-[10px] text-orange-600 bg-orange-50 px-2 py-1 rounded border border-orange-200">Awaiting client confirmation...</span>
                )}
              </>
            )}

            {/* Scheduling — once confirmed and not edited */}
            {hasFlowchart && isConfirmed && stage !== 'walkthrough_in_progress' && stage !== 'complete' && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500 mr-1">Schedule Walkthrough:</span>
                <button onClick={() => scheduleWalkthrough('teams')} className="text-[10px] px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 inline-flex items-center gap-1">
                  <Video className="h-3 w-3" /> Teams Meeting
                </button>
                <button onClick={() => scheduleWalkthrough('onsite')} className="text-[10px] px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> On-Site Visit
                </button>
                <button onClick={() => scheduleWalkthrough('message')} className="text-[10px] px-2.5 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded hover:bg-purple-100 inline-flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" /> Message Exchange
                </button>
              </div>
            )}

            {/* Mark Complete */}
            {stage === 'walkthrough_in_progress' && (
              <button onClick={() => saveStatus({ stage: 'complete' })} className="text-[10px] px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Mark Complete
              </button>
            )}

            {/* Save always available */}
            <button onClick={save} disabled={saving} className="text-[10px] px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded hover:bg-slate-200 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        );
      })()}

      {/* Narrative section */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <button onClick={() => toggleSection('narrative')} className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
          {sectionOpen.narrative ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          <FileText className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs font-semibold text-slate-700">{processLabel} — Narrative</span>
        </button>
        {sectionOpen.narrative && (
          <div className="p-3">
            <p className="text-[10px] text-slate-400 mb-2">Document the process from initiation to recording. Include key personnel, systems, documents, and transaction flow.</p>
            <textarea value={narrative} onChange={e => setNarrative(e.target.value)}
              placeholder={`1. How are transactions initiated?\n2. What authorisation is required?\n3. How are transactions recorded?\n4. What reconciliations are performed?\n5. What systems are used?`}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs min-h-[150px] focus:outline-none focus:border-blue-400 resize-y" />
          </div>
        )}
      </div>

      {/* Controls section */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <button onClick={() => toggleSection('controls')} className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
          <div className="flex items-center gap-2">
            {sectionOpen.controls ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
            <span className="text-xs font-semibold text-slate-700">Controls Identified ({controls.length})</span>
          </div>
          <button onClick={e => { e.stopPropagation(); setControls(prev => [...prev, { description: '', type: 'Manual', frequency: 'Per transaction', tested: false }]); }}
            className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100">+ Add</button>
        </button>
        {sectionOpen.controls && controls.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b text-[9px] text-slate-500 uppercase">
              <th className="px-2 py-1 text-left w-8">#</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-left w-24">Type</th>
              <th className="px-2 py-1 text-left w-28">Frequency</th>
              <th className="px-2 py-1 text-center w-12">Tested</th>
              <th className="px-2 py-1 w-8"></th>
            </tr></thead>
            <tbody>
              {controls.map((ctrl, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  <td className="px-2 py-1"><input type="text" value={ctrl.description} onChange={e => { const c = [...controls]; c[i] = { ...c[i], description: e.target.value }; setControls(c); }} className="w-full border rounded px-2 py-0.5 text-xs" placeholder="Describe the control..." /></td>
                  <td className="px-2 py-1"><select value={ctrl.type} onChange={e => { const c = [...controls]; c[i] = { ...c[i], type: e.target.value }; setControls(c); }} className="w-full border rounded px-1 py-0.5 text-xs"><option>Manual</option><option>Automated</option><option>IT Dependent</option></select></td>
                  <td className="px-2 py-1"><select value={ctrl.frequency} onChange={e => { const c = [...controls]; c[i] = { ...c[i], frequency: e.target.value }; setControls(c); }} className="w-full border rounded px-1 py-0.5 text-xs"><option>Per transaction</option><option>Daily</option><option>Weekly</option><option>Monthly</option><option>Quarterly</option><option>Annually</option></select></td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => { const c = [...controls]; c[i] = { ...c[i], tested: !c[i].tested }; setControls(c); }}
                      className={`w-4 h-4 rounded-full border-2 mx-auto flex items-center justify-center ${ctrl.tested ? 'bg-green-500 border-green-500' : 'border-slate-300'}`}>
                      {ctrl.tested && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                    </button>
                  </td>
                  <td className="px-2 py-1"><button onClick={() => setControls(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Flowchart section — always visible per process */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <button onClick={() => toggleSection('flowchart')} className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 transition-colors">
          {sectionOpen.flowchart ? <ChevronDown className="h-3.5 w-3.5 text-purple-400" /> : <ChevronRight className="h-3.5 w-3.5 text-purple-400" />}
          <span className="text-xs font-semibold text-purple-700">Process Flowchart{status.flowchart?.length ? ` (${status.flowchart.length} steps)` : ''}</span>
        </button>
        {sectionOpen.flowchart && (
          <div className="p-3">
            <WalkthroughFlowEditor
              key={`fc-${(status.flowchart || []).length}-${status.stage}`}
              steps={status.flowchart || []}
              userRole={userRole}
              engagementId={engagementId}
              onStepsChange={(newSteps) => {
                const updates: Partial<ProcessStatus> = { flowchart: newSteps };
                if (status.flowchartConfirmedAt) updates.flowchartEditedAfterConfirm = true;
                saveStatus(updates);
              }}
              readOnly={stage === 'complete'}
            />
          </div>
        )}
      </div>

      {/* Evidence section */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <button onClick={() => toggleSection('evidence')} className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
          <div className="flex items-center gap-2">
            {sectionOpen.evidence ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
            <span className="text-xs font-semibold text-slate-700">Evidence & Documents ({status.evidence?.length || 0})</span>
          </div>
        </button>
        {sectionOpen.evidence && (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-400">Documents from portal walkthrough requests{showAllDocs ? ' and all other sources' : ''}.</p>
              <button onClick={() => setShowAllDocs(prev => !prev)} className="text-[9px] px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100">
                {showAllDocs ? 'Walkthrough Only' : 'Show All Documents'}
              </button>
            </div>
            <div className="flex gap-2">
              <label className="text-[10px] px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer inline-flex items-center gap-1">
                <Upload className="h-3 w-3" /> Upload File
                <input type="file" className="hidden" accept=".pdf,.jpg,.png,.doc,.docx,.xlsx,.zip" onChange={async (e) => {
                  const file = await expandZipFile(e.target.files?.[0]);
                  if (!file) return;
                  const ev = status.evidence || [];
                  await saveStatus({ evidence: [...ev, { id: Date.now().toString(), name: file.name, type: file.type }] });
                }} />
              </label>
            </div>
            {(status.evidence || []).map(doc => (
              <div key={doc.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                {doc.storagePath && (
                  <input type="checkbox" checked={selectedEvidence.has(doc.id)}
                    onChange={() => setSelectedEvidence(prev => { const next = new Set(prev); next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id); return next; })}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500" />
                )}
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-700 flex-1">{doc.name}</span>
                {doc.storagePath ? (
                  <>
                    {(doc.annotations?.length || 0) > 0 && (
                      <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded" title={`${doc.annotations!.length} annotation(s)`}>
                        {doc.annotations!.length}
                      </span>
                    )}
                    <button onClick={() => setAnnotatingEvidenceId(doc.id)} className="text-red-500 hover:text-red-700" title="Annotate">
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button onClick={async () => {
                      try {
                        const res = await fetch(`/api/portal/download?storagePath=${encodeURIComponent(doc.storagePath!)}`);
                        if (res.ok) { const data = await res.json(); window.open(data.url, '_blank'); }
                      } catch {}
                    }} className="text-blue-500 hover:text-blue-700" title="Download"><Eye className="h-3 w-3" /></button>
                  </>
                ) : (
                  <span className="text-slate-300 text-[9px] italic">local only</span>
                )}
                <button onClick={() => { saveStatus({ evidence: (status.evidence || []).filter(d => d.id !== doc.id) }); setSelectedEvidence(prev => { const next = new Set(prev); next.delete(doc.id); return next; }); }} className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
              </div>
            ))}
            {(status.evidence || []).some(e => e.storagePath) && (
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => {
                  const allIds = (status.evidence || []).filter(e => e.storagePath).map(e => e.id);
                  setSelectedEvidence(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
                }} className="text-[9px] text-slate-500 hover:text-slate-700 underline">
                  {selectedEvidence.size === (status.evidence || []).filter(e => e.storagePath).length ? 'Deselect All' : 'Select All'}
                </button>
                <button onClick={analyseAndGenerate} disabled={analysing || selectedEvidence.size === 0} className="text-[10px] px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1">
                  {analysing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                  {analysing ? 'Analysing...' : `Analyse ${selectedEvidence.size > 0 ? selectedEvidence.size + ' ' : ''}Selected & Generate Flowchart`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Teams Meeting Modal */}
      {showTeamsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={() => setShowTeamsModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[500px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Teams Walkthrough Call — {processLabel}</h3>
              <button onClick={() => setShowTeamsModal(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Schedule new meeting */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-blue-700 mb-2">Schedule New Teams Call</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] text-slate-600 block mb-0.5">Date</label>
                    <input type="date" value={newMeetingDate} onChange={e => setNewMeetingDate(e.target.value)}
                      className="w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-600 block mb-0.5">Time</label>
                    <input type="time" value={newMeetingTime} onChange={e => setNewMeetingTime(e.target.value)}
                      className="w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400" />
                  </div>
                </div>
                <button onClick={scheduleTeamsMeeting} disabled={schedulingTeams || !newMeetingDate}
                  className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                  {schedulingTeams ? <Loader2 className="h-3 w-3 animate-spin" /> : <Video className="h-3 w-3" />}
                  {schedulingTeams ? 'Creating...' : 'Schedule Teams Meeting'}
                </button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-slate-200" />
                <span className="text-[10px] text-slate-400">or import an existing call</span>
                <div className="flex-1 border-t border-slate-200" />
              </div>

              {/* Import existing meeting */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-700">Recent Teams Meetings</p>
                  <button onClick={fetchTeamsMeetings} disabled={teamsLoading}
                    className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 disabled:opacity-50">
                    {teamsLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                {teamsMeetings.length === 0 && !teamsLoading && (
                  <p className="text-xs text-slate-400 italic py-4 text-center">Click Refresh to load recent Teams meetings</p>
                )}
                {teamsLoading && (
                  <div className="flex items-center justify-center py-4 gap-2 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" /><span className="text-xs">Loading meetings...</span>
                  </div>
                )}
                <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                  {teamsMeetings.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between px-3 py-2 border rounded-lg hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-700 truncate">{m.subject || 'Untitled Meeting'}</p>
                        <p className="text-[10px] text-slate-400">{new Date(m.startDateTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        {m.hasTranscript && <span className="text-[9px] px-1 bg-green-100 text-green-700 rounded">Has transcript</span>}
                      </div>
                      <button onClick={() => importTeamsMeeting(m)} disabled={importingMeeting === m.id}
                        className="shrink-0 ml-2 text-[10px] px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                        {importingMeeting === m.id ? 'Importing...' : 'Import & Summarise'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Annotator Modal */}
      {annotatingEvidenceId && (() => {
        const evidence = (status.evidence || []).find(e => e.id === annotatingEvidenceId);
        if (!evidence) return null;
        return (
          <DocumentAnnotator
            evidence={evidence}
            onClose={() => setAnnotatingEvidenceId(null)}
            onSave={async (annotations) => {
              const next = (status.evidence || []).map(e =>
                e.id === annotatingEvidenceId ? { ...e, annotations } : e
              );
              await saveStatus({ evidence: next });
            }}
          />
        );
      })()}
    </div>
  );
}

