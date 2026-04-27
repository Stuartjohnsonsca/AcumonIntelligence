'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send, CheckCircle2, UserPlus } from 'lucide-react';
import { PasteAwareTextarea } from './PasteAwareTextarea';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string | null;
  isActive: boolean;
}

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url?: string; uploadId?: string; storagePath?: string }[];
}

interface PortalRequestItem {
  id: string;
  section: string;
  question: string;
  response: string | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
  chatHistory?: ChatMessage[];
}

interface Props {
  clientId: string;
  token: string;
  engagementId?: string;
  onCountChange?: (count: number) => void;
  viewMode?: 'my' | 'team';
  portalUserName?: string;
}

const SECTIONS = [
  { key: 'questions', label: 'Questions & Answers' },
  // RI matters / Review points land here when an auditor uses "Send
  // to Client Portal" from the corresponding panel. Without an
  // explicit section the request is created in the DB but never
  // displayed because filtering matches section-by-section.
  { key: 'ri_matters', label: 'Senior Reviewer Queries' },
  { key: 'review_points', label: 'Review Queries' },
  // Error approvals from the Error Schedule "Send to client" flow.
  // The first chat message carries an errorApprovalsRequest payload —
  // this section's renderer shows checkbox list + a single Submit
  // that posts back JSON {approvedErrorIds: [...]}.
  { key: 'error_approvals', label: 'Audit Adjustments to Approve' },
  { key: 'walkthroughs', label: 'Walkthrough Documentation' },
  { key: 'calculations', label: 'Financial Calculations' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'connections', label: 'Connections' },
];

// Clean question text: remove [Questionnaire / Group] prefix if present.
// Also splits subject (first line) from body (rest), and strips the
// redundant "Audit: <fsLine> for <client> (period ending <date>)"
// preamble that flow-engine prepends — that context is already visible
// in the page header, duplicating it in every request just clutters
// the portal. Result: clean subject on top, nicely-wrapped body below.
function cleanQuestion(text: string): { subject: string; body: string; source: string | null } {
  let rest = String(text ?? '');
  // Strip a `[source]` tag at the very start.
  let source: string | null = null;
  const tag = rest.match(/^\[(.+?)\]\s*/);
  if (tag) { source = tag[1]; rest = rest.slice(tag[0].length); }
  // Normalise line endings.
  rest = rest.replace(/\r\n/g, '\n').trim();
  // Split subject from body at the first blank line (subject\n\nbody).
  let subject = '';
  let body = '';
  const blankIdx = rest.indexOf('\n\n');
  if (blankIdx >= 0) {
    subject = rest.slice(0, blankIdx).trim();
    body = rest.slice(blankIdx + 2).trim();
  } else {
    // Fallback: just take first line as subject if there's a line break.
    const nlIdx = rest.indexOf('\n');
    if (nlIdx >= 0) {
      subject = rest.slice(0, nlIdx).trim();
      body = rest.slice(nlIdx + 1).trim();
    } else {
      subject = rest;
    }
  }
  // Drop the redundant "Audit: … for … (period ending …)" preamble the
  // flow engine prepends. The information is already in the engagement
  // header so duplicating it in every request is noise.
  body = body.replace(/^Audit:[^\n]+\n\n?/i, '').trim();
  return { subject, body, source };
}

export function OutstandingTab({ clientId, token, engagementId, onCountChange, viewMode = 'team', portalUserName }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [responseFiles, setResponseFiles] = useState<Record<string, File[]>>({});
  // Per-request set of approved error IDs for the error_approvals
  // section. Held in component state until the client clicks Submit,
  // at which point it's serialised into `responses[item.id]` as JSON
  // and posted by the standard handleSubmitItem flow.
  const [approvalChecks, setApprovalChecks] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Set<string>>(new Set());
  // Team-member state for the "Assign to" dropdown — mirrors the
  // pattern already used on ExplanationsTab. Fetched alongside items
  // so the dropdown is ready when the user expands a section.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string>>({});

  useEffect(() => {
    loadItems();
  }, [clientId, engagementId]);

  async function loadItems() {
    setLoading(true);
    try {
      let url = `/api/portal/requests?clientId=${clientId}&status=outstanding`;
      if (engagementId) url += `&engagementId=${engagementId}`;
      console.log('[OutstandingTab] Fetching:', url);
      // Parallel: requests + team members. Team members feed the
      // Assign-to dropdown; we derive initial assignees from the
      // request rows' `assignedTo` field when present.
      const [res, teamRes] = await Promise.all([
        fetch(url),
        fetch(`/api/portal/users?clientId=${clientId}`),
      ]);
      if (res.ok) {
        const data = await res.json();
        const reqs = data.requests || [];
        console.log('[OutstandingTab] Loaded', reqs.length, 'items, sections:', [...new Set(reqs.map((r: any) => r.section))]);
        setItems(reqs);
        onCountChange?.(reqs.length);
        // Seed local `assignees` state from whatever's already on each
        // row so the dropdown reflects the server truth.
        const seeded: Record<string, string> = {};
        for (const r of reqs) {
          if ((r as any).assignedTo) seeded[r.id] = (r as any).assignedTo;
        }
        setAssignees(seeded);
      } else {
        console.error('[OutstandingTab] Fetch failed:', res.status);
      }
      if (teamRes.ok) {
        const users = await teamRes.json();
        setTeamMembers((Array.isArray(users) ? users : []).filter((u: any) => u.isActive));
      }
    } catch (err) { console.error('[OutstandingTab] Error:', err); }
    setLoading(false);
  }

  /** Reassign an outstanding request to a different team member —
   *  keeps the item outstanding; just updates the displayed assignee.
   *  Mirrors the PUT call ExplanationsTab uses. */
  async function handleAssign(itemId: string, assigneeName: string) {
    // Optimistic local update so the UI responds immediately.
    setAssignees(prev => ({ ...prev, [itemId]: assigneeName }));
    try {
      await fetch('/api/portal/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: itemId, action: 'assign_portal', assignTo: assigneeName }),
      });
    } catch { /* tolerant — next refresh will re-sync from server */ }
  }

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function getItemsBySection(sectionKey: string) {
    return items.filter(i => {
      if (i.section !== sectionKey || successes.has(i.id)) return false;
      if (viewMode === 'my' && portalUserName) {
        // Show items assigned to this user, or unassigned items
        const assignedTo = (i as any).assignedTo || '';
        return !assignedTo || assignedTo === portalUserName || assignedTo.includes(portalUserName);
      }
      return true; // Team view: show all
    });
  }

  async function handleSubmitItem(item: PortalRequestItem) {
    const response = responses[item.id]?.trim();
    const files = responseFiles[item.id] || [];
    if (!response && files.length === 0) return;

    setSubmitting(prev => ({ ...prev, [item.id]: true }));
    setErrors(prev => { const n = { ...prev }; delete n[item.id]; return n; });

    try {
      // Upload files to Azure Blob first
      const uploadedFiles: { name: string; url: string; uploadId: string }[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('requestId', item.id);
        const uploadRes = await fetch('/api/portal/upload', { method: 'POST', body: formData });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          uploadedFiles.push({ name: file.name, url: uploadData.url || '', uploadId: uploadData.uploadId });
        }
      }

      const fileNames = uploadedFiles.map(f => f.name);
      const fullResponse = fileNames.length > 0
        ? `${response || ''}${response ? '\n' : ''}[Attachments: ${fileNames.join(', ')}]`
        : (response || '');

      const res = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          response: fullResponse,
          respondedByName: 'Portal User',
          attachments: uploadedFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [item.id]: data.error || 'Submission failed' }));
      } else {
        setSuccesses(prev => new Set(prev).add(item.id));
        setResponses(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        setResponseFiles(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        onCountChange?.(items.filter(i => !successes.has(i.id) && i.id !== item.id).length);
      }
    } catch {
      setErrors(prev => ({ ...prev, [item.id]: 'Network error' }));
    }
    setSubmitting(prev => ({ ...prev, [item.id]: false }));
  }

  function StatusDot({ count }: { count: number }) {
    return (
      <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold text-white ${
        count === 0 ? 'bg-green-500' : 'bg-red-500'
      }`}>
        {count}
      </span>
    );
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 font-medium">No outstanding items</p>
          <p className="text-xs text-slate-400 mt-1">All requests have been responded to.</p>
        </div>
      )}

      {SECTIONS.map(section => {
        const sectionItems = getItemsBySection(section.key);
        const isExpanded = expandedSections.has(section.key);

        return (
          <div key={section.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                <span className="text-sm font-semibold text-slate-800">{section.label}</span>
                <StatusDot count={sectionItems.length} />
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-slate-100">
                {sectionItems.length === 0 ? (
                  <div className="px-5 py-4 text-xs text-slate-400 italic">No outstanding items in this section.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {sectionItems.map((item) => {
                      const { subject, body, source } = cleanQuestion(item.question);
                      return (
                        <div key={item.id} className="px-5 py-3">
                          <div className="mb-2">
                            {/* Subject — short, bold, one line */}
                            <p className="text-sm text-slate-900 font-semibold">{subject || '(no subject)'}</p>
                            {/* Body — preserves line breaks + whitespace so
                                multi-paragraph messages render readably
                                instead of as one run-on blob */}
                            {body && (
                              <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed">
                                {body}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {source && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{source}</span>
                              )}
                              <span className="text-[10px] text-slate-400">
                                Requested by {item.requestedByName} &middot; {new Date(item.requestedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {/* Assign-to dropdown — only shown when the
                                  client has more than one portal user. For
                                  single-user clients there's no one to
                                  reassign to, so we skip the clutter. */}
                              {teamMembers.length > 1 && (
                                <span className="inline-flex items-center gap-1">
                                  <UserPlus className="h-3 w-3 text-slate-400" />
                                  <span className="text-[10px] text-slate-500">Assign to:</span>
                                  <select
                                    value={assignees[item.id] || ''}
                                    onChange={e => handleAssign(item.id, e.target.value)}
                                    className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white"
                                  >
                                    <option value="">— Unassigned —</option>
                                    {teamMembers.map(m => (
                                      <option key={m.id} value={m.name}>{m.name}{m.role ? ` (${m.role})` : ''}</option>
                                    ))}
                                  </select>
                                </span>
                              )}
                              {assignees[item.id] && teamMembers.length <= 1 && (
                                <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                                  Assigned: {assignees[item.id]}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Chat history — show conversation thread */}
                          {item.chatHistory && item.chatHistory.length > 0 && (
                            <div className="mb-2 space-y-1.5 max-h-40 overflow-y-auto">
                              {item.chatHistory.map((msg, mi) => (
                                <div key={mi} className={`flex ${msg.from === 'client' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-xs ${
                                    msg.from === 'client' ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-800'
                                  }`}>
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="font-semibold text-[10px]">{msg.name}</span>
                                      <span className="text-[9px] text-slate-400">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <p>{msg.message}</p>
                                    {msg.attachments && msg.attachments.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {msg.attachments.map((a, ai) => (
                                          <button key={ai} onClick={async () => {
                                            try {
                                              const params = a.uploadId ? `uploadId=${a.uploadId}` : a.storagePath ? `storagePath=${encodeURIComponent(a.storagePath)}` : '';
                                              if (!params && a.url) { window.open(a.url, '_blank'); return; }
                                              const res = await fetch(`/api/portal/download?${params}`);
                                              if (res.ok) { const data = await res.json(); window.open(data.url, '_blank'); }
                                            } catch {}
                                          }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/50 rounded text-[9px] border text-blue-600 hover:text-blue-800 hover:bg-blue-50 cursor-pointer">📎 {a.name}</button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Error-approvals: render a checkbox list of
                              the auditor's misstatements + a Submit
                              that posts back JSON. The standard
                              textarea / file-attach UI doesn't apply
                              here. */}
                          {item.section === 'error_approvals' ? (() => {
                            const firstChat = item.chatHistory?.[0] as any;
                            const approvalItems: Array<{ errorId: string; fsLine: string; accountCode: string | null; description: string; errorAmount: number; errorType: string }> =
                              Array.isArray(firstChat?.errorApprovalsRequest?.items) ? firstChat.errorApprovalsRequest.items : [];
                            const checked = approvalChecks[item.id] || new Set<string>();
                            const toggle = (id: string) => {
                              setApprovalChecks(prev => {
                                const next: Record<string, Set<string>> = { ...prev };
                                const s = new Set(next[item.id] || []);
                                if (s.has(id)) s.delete(id); else s.add(id);
                                next[item.id] = s;
                                return next;
                              });
                            };
                            const allTicked = approvalItems.length > 0 && approvalItems.every(a => checked.has(a.errorId));
                            const setAll = (on: boolean) => {
                              setApprovalChecks(prev => ({
                                ...prev,
                                [item.id]: on ? new Set(approvalItems.map(a => a.errorId)) : new Set(),
                              }));
                            };
                            const fmtAmt = (n: number) => Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            return (
                              <div className="space-y-2">
                                {approvalItems.length === 0 ? (
                                  <div className="text-xs text-slate-400 italic">No items to approve.</div>
                                ) : (
                                  <>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-600">Tick the items you accept and have adjusted.</span>
                                      <button
                                        onClick={() => setAll(!allTicked)}
                                        className="text-blue-600 hover:underline"
                                      >{allTicked ? 'Untick all' : 'Tick all'}</button>
                                    </div>
                                    <div className="border border-slate-200 rounded divide-y divide-slate-100 bg-white">
                                      {approvalItems.map(a => {
                                        const isChecked = checked.has(a.errorId);
                                        const isDr = a.errorAmount >= 0;
                                        return (
                                          <label key={a.errorId} className={`flex items-start gap-2 px-3 py-2 cursor-pointer ${isChecked ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={() => toggle(a.errorId)}
                                              className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0">
                                              <div className="text-xs text-slate-700 truncate">
                                                <span className="font-medium">{a.fsLine}</span>
                                                {a.accountCode && <span className="text-slate-400 font-mono ml-1">· {a.accountCode}</span>}
                                              </div>
                                              <div className="text-[11px] text-slate-500">{a.description}</div>
                                            </div>
                                            <div className="text-right text-xs font-mono tabular-nums whitespace-nowrap">
                                              {isDr ? `Dr ${fmtAmt(a.errorAmount)}` : `Cr ${fmtAmt(a.errorAmount)}`}
                                            </div>
                                          </label>
                                        );
                                      })}
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="text-[11px] text-slate-500">{checked.size}/{approvalItems.length} ticked</span>
                                      <button
                                        onClick={async () => {
                                          // Pack approved IDs into the response field; the server
                                          // /api/portal/requests POST handler walks them and marks
                                          // each error resolution='in_tb'. Empty selection still
                                          // posts so the client can confirm "I accept none".
                                          const approvedErrorIds = Array.from(checked);
                                          const payload = JSON.stringify({ approvedErrorIds, decidedAt: new Date().toISOString() });
                                          setResponses(prev => ({ ...prev, [item.id]: payload }));
                                          // Wait one tick so the responses state lands before
                                          // handleSubmitItem reads it.
                                          await Promise.resolve();
                                          await handleSubmitItem({ ...item, } as any);
                                        }}
                                        disabled={submitting[item.id]}
                                        className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                                      >
                                        {submitting[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                        Submit response
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })() : (
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <PasteAwareTextarea
                                value={responses[item.id] || ''}
                                onChange={text => setResponses(prev => ({ ...prev, [item.id]: text }))}
                                onFilesAdded={newFiles => setResponseFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...newFiles] }))}
                                placeholder={item.chatHistory?.length ? "Continue the conversation... (paste supported)" : "Enter your response... (you can paste from Excel, Word, or screenshots)"}
                                rows={2}
                              />
                              {(responseFiles[item.id]?.length || 0) > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {responseFiles[item.id].map((f, fi) => (
                                    <span key={fi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
                                      📎 {f.name}
                                      <button onClick={() => setResponseFiles(prev => ({ ...prev, [item.id]: prev[item.id].filter((_, i) => i !== fi) }))} className="text-red-400 hover:text-red-600">×</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <label className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                                + Attach file
                                <input type="file" multiple className="hidden" onChange={e => {
                                  const files = Array.from(e.target.files || []);
                                  setResponseFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...files] }));
                                  e.target.value = '';
                                }} />
                              </label>
                            </div>
                            <button
                              onClick={() => handleSubmitItem(item)}
                              disabled={!responses[item.id]?.trim() || submitting[item.id]}
                              className="self-end px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                            >
                              {submitting[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Submit
                            </button>
                          </div>
                          )}
                          {errors[item.id] && (
                            <p className="text-xs text-red-500 mt-1">{errors[item.id]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
