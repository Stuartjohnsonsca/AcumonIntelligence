'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Send, Upload, UserPlus, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { PasteAwareTextarea } from './PasteAwareTextarea';

interface ExplanationItem {
  id: string;
  question: string;
  section: string;
  status: string;
  requestedByName: string;
  requestedAt: string;
  // PAR-specific fields stored in the question or metadata
  particulars?: string;
  currentYear?: number;
  priorYear?: number;
  absVariance?: number;
  absVariancePercent?: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

interface Props {
  clientId: string;
  token: string;
  engagementId?: string;
  onCountChange?: (count: number) => void;
  viewMode?: 'my' | 'team';
  portalUserName?: string;
}

function formatCurrency(v: number | null | undefined): string {
  if (v == null) return '';
  const abs = Math.abs(v);
  const s = '£' + abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ExplanationsTab({ clientId, token, engagementId, onCountChange, viewMode = 'team', portalUserName }: Props) {
  const [items, setItems] = useState<ExplanationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [successes, setSuccesses] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastEdited, setLastEdited] = useState<Record<string, { name: string; at: string }>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { loadData(); }, [clientId, engagementId]);

  async function loadData() {
    setLoading(true);
    try {
      let url = `/api/portal/requests?clientId=${clientId}&status=outstanding&section=explanations`;
      if (engagementId) url += `&engagementId=${engagementId}`;
      const [itemsRes, teamRes] = await Promise.all([
        fetch(url),
        fetch(`/api/portal/users?clientId=${clientId}`),
      ]);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        const reqs = data.requests || [];
        setItems(reqs);
        onCountChange?.(reqs.length);
      }
      if (teamRes.ok) {
        const users = await teamRes.json();
        setTeamMembers((Array.isArray(users) ? users : []).filter((u: any) => u.isActive));
      }
    } catch {}
    setLoading(false);
  }

  async function handleSubmit(item: ExplanationItem) {
    const response = responses[item.id]?.trim();
    const itemFiles = files[item.id] || [];
    if (!response && itemFiles.length === 0) return;

    setSubmitting(prev => ({ ...prev, [item.id]: true }));
    setErrors(prev => { const n = { ...prev }; delete n[item.id]; return n; });

    try {
      const fileNames = itemFiles.map(f => f.name);
      const fullResponse = [
        response || '',
        fileNames.length > 0 ? `[Attachments: ${fileNames.join(', ')}]` : '',
        assignees[item.id] ? `[Assigned to: ${assignees[item.id]}]` : '',
        lastEdited[item.id] ? `[Last edited by: ${lastEdited[item.id].name} on ${lastEdited[item.id].at}]` : '',
      ].filter(Boolean).join('\n');

      const res = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          response: fullResponse,
          respondedByName: assignees[item.id] || 'Portal User',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [item.id]: data.error || 'Failed' }));
      } else {
        setSuccesses(prev => new Set(prev).add(item.id));
        setResponses(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        setFiles(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        setAssignees(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        onCountChange?.(items.filter(i => !successes.has(i.id) && i.id !== item.id).length);
      }
    } catch {
      setErrors(prev => ({ ...prev, [item.id]: 'Network error' }));
    }
    setSubmitting(prev => ({ ...prev, [item.id]: false }));
  }

  function handleTextChange(itemId: string, text: string) {
    setResponses(prev => ({ ...prev, [itemId]: text }));
    setLastEdited(prev => ({ ...prev, [itemId]: { name: portalUserName || 'Portal User', at: new Date().toLocaleDateString('en-GB') } }));
  }

  // Assign to a team member — keeps item outstanding, just updates assignee
  async function handleAssign(itemId: string, assigneeName: string) {
    try {
      await fetch('/api/portal/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: itemId, action: 'assign_portal', assignTo: assigneeName }),
      });
      // Update local state
      setAssignees(prev => ({ ...prev, [itemId]: assigneeName }));
    } catch {}
  }

  const activeItems = items.filter(i => {
    if (successes.has(i.id)) return false;
    if (viewMode === 'my' && portalUserName) {
      const assigned = assignees[i.id] || '';
      return !assigned || assigned === portalUserName || assigned.includes(portalUserName);
    }
    return true;
  });

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {activeItems.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 font-medium">No explanations required</p>
          <p className="text-xs text-slate-400 mt-1">All PAR items have been addressed.</p>
        </div>
      )}

      {activeItems.map(item => {
        // Parse PAR data: line 1 = particulars, line 2 = CY: £x | PY: £x | Variance: £x (x%)
        const lines = item.question.split('\n');
        const particulars = lines[0];
        const metaLine = lines[1] || '';
        // Parse metadata
        const cyMatch = metaLine.match(/CY:\s*(£?[\d,.()-]+|—)/);
        const pyMatch = metaLine.match(/PY:\s*(£?[\d,.()-]+|—)/);
        const varMatch = metaLine.match(/Variance:\s*(£?[\d,.()-]+|—)/);
        const pctMatch = metaLine.match(/\(([\d.]+%)\)/);

        return (
          <div key={item.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Header — clear ask with prominent figures */}
            <div className="px-5 py-4 border-b border-slate-100 bg-orange-50/30">
              <p className="text-base font-semibold text-slate-900 mb-2">{particulars}</p>
              <p className="text-sm text-orange-700 font-medium mb-3">
                Please explain the movement in this balance between the current and prior year.
              </p>

              {/* Figures — large and clear */}
              {metaLine && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-medium mb-1">Current Year</p>
                    <p className="text-lg font-bold text-slate-800">{cyMatch?.[1] || '—'}</p>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-medium mb-1">Prior Year</p>
                    <p className="text-lg font-bold text-slate-800">{pyMatch?.[1] || '—'}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg border border-orange-200 p-3 text-center">
                    <p className="text-[10px] text-orange-600 uppercase font-medium mb-1">Variance</p>
                    <p className="text-lg font-bold text-orange-700">{varMatch?.[1] || '—'}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg border border-orange-200 p-3 text-center">
                    <p className="text-[10px] text-orange-600 uppercase font-medium mb-1">Change</p>
                    <p className="text-lg font-bold text-orange-700">{pctMatch?.[1] || '—'}</p>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-400 mt-2">Requested {formatDate(item.requestedAt)} by {item.requestedByName}</p>
            </div>

            {/* Response area */}
            <div className="px-5 py-3 space-y-3">
              {/* Assign to team member */}
              <div className="flex items-center gap-2">
                <UserPlus className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs text-slate-500">Assign to:</span>
                <select
                  value={assignees[item.id] || ''}
                  onChange={e => handleAssign(item.id, e.target.value)}
                  className="text-xs border rounded px-2 py-1 min-w-[180px]"
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.name}>{m.name}{m.role ? ` (${m.role})` : ''}</option>
                  ))}
                </select>
              </div>

              {/* File upload */}
              <div>
                <div className="flex items-center gap-2">
                  <Upload className="h-3.5 w-3.5 text-slate-400" />
                  <label className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                    Upload files
                    <input
                      ref={el => { fileInputRefs.current[item.id] = el; }}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={e => {
                        const newFiles = Array.from(e.target.files || []);
                        setFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...newFiles] }));
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {(files[item.id]?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5 ml-5">
                    {files[item.id].map((f, fi) => (
                      <span key={fi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
                        📎 {f.name}
                        <button onClick={() => setFiles(prev => ({ ...prev, [item.id]: prev[item.id].filter((_, i) => i !== fi) }))} className="text-red-400 hover:text-red-600">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Multiline text response — supports paste from Excel/Word/screenshots */}
              <div>
                <PasteAwareTextarea
                  value={responses[item.id] || ''}
                  onChange={text => handleTextChange(item.id, text)}
                  onFilesAdded={newFiles => setFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...newFiles] }))}
                  placeholder="Enter your explanation... (you can paste from Excel, Word, or screenshots)"
                  rows={4}
                />
                {lastEdited[item.id] && (
                  <p className="text-[9px] text-slate-400 mt-0.5">Last edited by {lastEdited[item.id].name} on {lastEdited[item.id].at}</p>
                )}
              </div>

              {/* Submit */}
              <div className="flex items-center justify-between">
                {errors[item.id] && <p className="text-xs text-red-500">{errors[item.id]}</p>}
                <div />
                <button
                  onClick={() => handleSubmit(item)}
                  disabled={(!responses[item.id]?.trim() && (files[item.id]?.length || 0) === 0) || submitting[item.id]}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {submitting[item.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Submit to Audit Team
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
