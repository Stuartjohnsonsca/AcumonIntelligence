'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, CheckCircle2, Plus, Trash2, Send, Video, MapPin, MessageSquare, Loader2, ChevronDown, ChevronRight, Upload, Eye, X } from 'lucide-react';

// ─── Types ───
interface ProcessTab { key: string; label: string; }
interface Control { description: string; type: string; frequency: string; tested: boolean; }
interface FlowStep { id: string; label: string; type: 'start' | 'action' | 'decision' | 'end'; next: string[]; condition?: string; }
interface ProcessStatus {
  stage: 'draft' | 'requested' | 'received' | 'flowchart_generated' | 'sent_for_verification' | 'verified' | 'scheduling' | 'walkthrough_in_progress' | 'complete';
  portalRequestId?: string;
  verificationRequestId?: string;
  schedulingMethod?: 'teams' | 'onsite' | 'message';
  flowchart?: FlowStep[];
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

interface Props { engagementId: string; }

export function WalkthroughsTab({ engagementId }: Props) {
  const [processes, setProcesses] = useState<ProcessTab[]>([
    { key: 'sales', label: 'Sales Process' },
    { key: 'purchases', label: 'Purchase Process' },
  ]);
  const [activeTab, setActiveTab] = useState('sales');
  const [newProcessName, setNewProcessName] = useState('');
  const [showAddProcess, setShowAddProcess] = useState(false);

  // Load custom processes from permanent file
  useEffect(() => {
    fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_processes`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.data?.processes?.length > 0) setProcesses(data.data.processes);
        else if (data?.answers?.processes?.length > 0) setProcesses(data.answers.processes);
      }).catch(() => {});
  }, [engagementId]);

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
    if (activeTab === key) setActiveTab(updated[0].key);
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
      </div>

      {/* Process sub-tabs */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
        {processes.map(tab => (
          <div key={tab.key} className="relative group">
            <button
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
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
          <button onClick={() => setShowAddProcess(true)} className="px-2 py-1.5 text-xs text-slate-400 hover:text-blue-600 transition-colors">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Active process content */}
      <WalkthroughProcess engagementId={engagementId} processKey={activeTab} processLabel={processes.find(p => p.key === activeTab)?.label || activeTab} />
    </div>
  );
}

// ─── Single Process Walkthrough ───
function WalkthroughProcess({ engagementId, processKey, processLabel }: { engagementId: string; processKey: string; processLabel: string }) {
  const [narrative, setNarrative] = useState('');
  const [controls, setControls] = useState<Control[]>([]);
  const [status, setStatus] = useState<ProcessStatus>({ stage: 'draft' });
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({ narrative: true, controls: true, flowchart: true, evidence: true });

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_${processKey}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/engagements/${engagementId}/permanent-file?section=walkthrough_${processKey}_status`).then(r => r.ok ? r.json() : null),
    ]).then(([content, statusData]) => {
      const answers = content?.data || content?.answers || {};
      setNarrative(answers.narrative || '');
      setControls(answers.controls || []);
      const st = statusData?.data || statusData?.answers || {};
      if (st.stage) setStatus(st);
    }).catch(() => {});
  }, [engagementId, processKey]);

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
    await fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: `walkthrough_${processKey}_status`, data: updated }),
    }).catch(() => {});
  }

  // Request documentation from client
  async function requestFromClient() {
    setRequesting(true);
    try {
      // Get clientId
      const engRes = await fetch(`/api/engagements/${engagementId}`);
      const engData = await engRes.json();
      const clientId = engData.engagement?.clientId;
      if (!clientId) return;

      // Create portal request
      const res = await fetch(`/api/engagements/${engagementId}/outstanding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'portal_request',
          title: `${processLabel} — Documentation Request`,
          description: `Please provide documentation for your ${processLabel.toLowerCase()}. This can be:\n• Process maps or flowcharts\n• Procedure manuals\n• A written description of the process from start to finish\n\nPlease upload files or type your description below.`,
          assignedTo: null,
          priority: 'normal',
          portalSection: 'walkthroughs',
          portalQuestion: `[Walkthrough: ${processLabel}] Please provide your ${processLabel.toLowerCase()} documentation — process maps, procedure manuals, or a written description.`,
          clientId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await saveStatus({ stage: 'requested', portalRequestId: data.item?.id || data.id });
      }
    } catch {} finally { setRequesting(false); }
  }

  // Generate flowchart from documentation
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

  // Send flowchart for client verification
  async function sendForVerification() {
    try {
      const engRes = await fetch(`/api/engagements/${engagementId}`);
      const engData = await engRes.json();
      const clientId = engData.engagement?.clientId;
      if (!clientId) return;

      const flowSummary = (status.flowchart || []).map((s, i) => `${i + 1}. [${s.type}] ${s.label}`).join('\n');

      const res = await fetch(`/api/engagements/${engagementId}/outstanding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'portal_request',
          title: `${processLabel} — Verify Flowchart`,
          description: `Please review the ${processLabel.toLowerCase()} flowchart below and confirm it accurately represents your process.\n\nIf incorrect, please describe what needs changing or upload a corrected version.\n\n${flowSummary}`,
          portalSection: 'walkthroughs',
          portalQuestion: `[Walkthrough Verification: ${processLabel}] Please verify this process flowchart is accurate. Reply Yes to confirm, or describe corrections / upload a corrected file.`,
          clientId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await saveStatus({ stage: 'sent_for_verification', verificationRequestId: data.item?.id || data.id });
      }
    } catch {}
  }

  // Schedule walkthrough
  async function scheduleWalkthrough(method: 'teams' | 'onsite' | 'message') {
    try {
      const engRes = await fetch(`/api/engagements/${engagementId}`);
      const engData = await engRes.json();
      const clientId = engData.engagement?.clientId;
      if (!clientId) return;

      const messages: Record<string, string> = {
        teams: `Please schedule a Microsoft Teams meeting to perform a walkthrough of your ${processLabel.toLowerCase()}. We will need to speak with the person(s) responsible for this process.`,
        onsite: `We would like to arrange an on-site visit to perform a walkthrough of your ${processLabel.toLowerCase()}. Please advise when would be convenient and who should be available.`,
        message: `We will be performing a walkthrough of your ${processLabel.toLowerCase()} via message exchange. We will be asking for specific evidence supporting each step of the process. Please respond to each request below.`,
      };

      await fetch(`/api/engagements/${engagementId}/outstanding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'portal_request',
          title: `${processLabel} — ${method === 'teams' ? 'Teams Meeting' : method === 'onsite' ? 'On-Site Visit' : 'Message Exchange'}`,
          description: messages[method],
          portalSection: 'walkthroughs',
          portalQuestion: `[Walkthrough: ${processLabel}] ${messages[method]}`,
          clientId,
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

      {/* Action buttons based on stage */}
      <div className="flex items-center gap-2 flex-wrap">
        {stage === 'draft' && (
          <>
            <button onClick={save} disabled={saving} className="text-[10px] px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button onClick={requestFromClient} disabled={requesting || !narrative.trim()} className="text-[10px] px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1">
              <Send className="h-3 w-3" /> {requesting ? 'Sending...' : 'Request from Client'}
            </button>
          </>
        )}
        {(stage === 'requested' || stage === 'received') && (
          <button onClick={generateFlowchart} disabled={generating || !narrative.trim()} className="text-[10px] px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1">
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} Generate Flowchart
          </button>
        )}
        {stage === 'flowchart_generated' && (
          <button onClick={sendForVerification} className="text-[10px] px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 inline-flex items-center gap-1">
            <Send className="h-3 w-3" /> Send for Client Verification
          </button>
        )}
        {stage === 'verified' && (
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
        {stage === 'walkthrough_in_progress' && (
          <button onClick={() => saveStatus({ stage: 'complete' })} className="text-[10px] px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Mark Complete
          </button>
        )}
        {/* Save is always available */}
        {stage !== 'draft' && (
          <button onClick={save} disabled={saving} className="text-[10px] px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded hover:bg-slate-200 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

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

      {/* Flowchart section (shown after generation) */}
      {status.flowchart && status.flowchart.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <button onClick={() => toggleSection('flowchart')} className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 transition-colors">
            {sectionOpen.flowchart ? <ChevronDown className="h-3.5 w-3.5 text-purple-400" /> : <ChevronRight className="h-3.5 w-3.5 text-purple-400" />}
            <span className="text-xs font-semibold text-purple-700">Process Flowchart ({status.flowchart.length} steps)</span>
          </button>
          {sectionOpen.flowchart && (
            <div className="p-3">
              <FlowchartDisplay steps={status.flowchart} />
            </div>
          )}
        </div>
      )}

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
            <p className="text-[10px] text-slate-400">Attach supporting documents from portal messages, local files, or screenshots.</p>
            <div className="flex gap-2">
              <label className="text-[10px] px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer inline-flex items-center gap-1">
                <Upload className="h-3 w-3" /> Upload File
                <input type="file" className="hidden" accept=".pdf,.jpg,.png,.doc,.docx,.xlsx" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const ev = status.evidence || [];
                  await saveStatus({ evidence: [...ev, { id: Date.now().toString(), name: file.name, type: file.type }] });
                }} />
              </label>
            </div>
            {(status.evidence || []).map(doc => (
              <div key={doc.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-700 flex-1">{doc.name}</span>
                <button className="text-slate-400 hover:text-blue-600"><Eye className="h-3 w-3" /></button>
                <button onClick={() => saveStatus({ evidence: (status.evidence || []).filter(d => d.id !== doc.id) })} className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Structured Flowchart Display ───
function FlowchartDisplay({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const isStart = step.type === 'start';
        const isEnd = step.type === 'end';
        const isDecision = step.type === 'decision';
        const bg = isStart ? 'bg-green-100 border-green-300 text-green-800'
          : isEnd ? 'bg-red-100 border-red-300 text-red-800'
          : isDecision ? 'bg-amber-50 border-amber-300 text-amber-800'
          : 'bg-blue-50 border-blue-200 text-blue-800';
        const shape = isDecision ? 'rotate-0' : '';

        return (
          <div key={step.id} className="flex flex-col items-center">
            {i > 0 && <div className="w-px h-3 bg-slate-300" />}
            {i > 0 && <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-slate-300 -mt-px" />}
            <div className={`px-4 py-1.5 rounded-lg border text-[10px] font-medium text-center max-w-md ${bg} ${isDecision ? 'transform rotate-0 border-dashed' : ''}`}>
              {isDecision && <span className="text-[8px] text-amber-500 block">DECISION</span>}
              {step.label}
              {step.condition && <div className="text-[8px] text-slate-500 mt-0.5 italic">Condition: {step.condition}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
