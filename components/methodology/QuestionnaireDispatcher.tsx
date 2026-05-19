'use client';

import { useState, useEffect, useCallback } from 'react';
import { Send, Loader2, ChevronDown, ChevronRight, CheckCircle2, MessageCircle } from 'lucide-react';
import { SignOffDots } from './SignOffDots';
import type { TeamMemberLite } from '@/lib/sign-off-helpers';

interface QuestionnaireOption {
  id: string;
  name: string;
  description: string | null;
  auditType: string;
}

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
}

interface Dispatch {
  id: string;
  question: string;
  status: string;
  requestedAt: string;
  respondedAt: string | null;
  respondedByName: string | null;
  response: string | null;
  chatHistory: ChatMessage[] | null;
  metadata: {
    kind?: string;
    questionnaireId?: string;
    questionnaireName?: string;
    tabKey?: string;
    tabLabel?: string;
    signOffs?: Record<string, { userId: string; userName: string; timestamp: string } | undefined>;
  } | null;
}

interface Props {
  engagementId: string;
  /** Stable key for the tab this dispatcher lives on (e.g. 'ethics',
   *  'continuance'). The created PortalRequest's section is
   *  `questionnaire:${tabKey}` so the right dispatches come back. */
  tabKey: string;
  /** Human label rendered in the request subject and dispatcher header. */
  tabLabel: string;
  /** Optional — engagement context. When omitted, the component fetches
   *  what it needs from /api/engagements/[id] so it can be dropped into
   *  any tab without the caller having to plumb props through. */
  auditType?: string;
  teamMembers?: TeamMemberLite[];
  currentUserId?: string;
}

/**
 * Embedded panel mounted on each engagement schedule tab. Lets the
 * auditor pick a Questionnaire template, fire it to the Client Portal
 * (becomes an Outstanding-tab item), review the client's response,
 * and sign it off with the standard P / R / RI dots.
 */
export function QuestionnaireDispatcher({
  engagementId,
  tabKey,
  tabLabel,
  auditType: auditTypeProp,
  teamMembers: teamMembersProp,
  currentUserId: currentUserIdProp,
}: Props) {
  const [options, setOptions] = useState<QuestionnaireOption[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [signingRole, setSigningRole] = useState<{ dispatchId: string; role: string } | null>(null);
  const [auditType, setAuditType] = useState<string>(auditTypeProp || '');
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[] | undefined>(teamMembersProp);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(currentUserIdProp);

  // Self-fetch engagement context when the caller didn't supply it —
  // keeps the dispatcher drop-in friendly for tabs that don't
  // already have the team / audit type in scope.
  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      const need = !auditTypeProp || !teamMembersProp || !currentUserIdProp;
      if (!need) return;
      try {
        const res = await fetch(`/api/engagements/${engagementId}`);
        if (!res.ok) return;
        const data = await res.json();
        const eng = data?.engagement;
        if (!eng || cancelled) return;
        if (!auditTypeProp) setAuditType(eng.auditType || '');
        if (!teamMembersProp && Array.isArray(eng.teamMembers)) {
          setTeamMembers(eng.teamMembers.map((m: any) => ({
            userId: m.userId,
            userName: m.user?.name || m.userName || '',
            role: m.role,
          })));
        }
      } catch { /* tolerant — dispatcher still works without team info, just no sign-off gating */ }
    }
    async function loadMe() {
      if (currentUserIdProp) return;
      try {
        const res = await fetch('/api/auth/session');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.user?.id) setCurrentUserId(data.user.id);
      } catch { /* tolerant */ }
    }
    loadContext();
    loadMe();
    return () => { cancelled = true; };
  }, [engagementId, auditTypeProp, teamMembersProp, currentUserIdProp]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [optsRes, dispRes] = await Promise.all([
        fetch('/api/methodology-admin/templates?templateType=questionnaire'),
        fetch(`/api/engagements/${engagementId}/questionnaire-dispatch?tabKey=${encodeURIComponent(tabKey)}`),
      ]);
      if (optsRes.ok) {
        const data = await optsRes.json();
        const raw: any[] = Array.isArray(data.templates) ? data.templates : [];
        const filtered = raw
          .filter(t => t && t.id && t.items)
          // Only show questionnaires configured for ALL or this
          // engagement's audit type. Filtering here avoids the
          // dropdown showing irrelevant templates that wouldn't
          // make sense for the client to receive.
          .filter(t => {
            const at = String(t.auditType || '').toUpperCase();
            return at === 'ALL' || at === String(auditType || '').toUpperCase() || at.startsWith(`${String(auditType || '').toUpperCase()}_`);
          })
          .map(t => ({
            id: t.id,
            name: (t.items?.name as string) || 'Untitled questionnaire',
            description: (t.items?.description as string) || null,
            auditType: String(t.auditType || 'ALL'),
          }));
        setOptions(filtered);
      }
      if (dispRes.ok) {
        const data = await dispRes.json();
        setDispatches(Array.isArray(data.dispatches) ? data.dispatches : []);
      }
    } finally {
      setLoading(false);
    }
  }, [engagementId, tabKey, auditType]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    if (!selectedId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/questionnaire-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionnaireId: selectedId, tabKey, tabLabel }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Send failed (${res.status})`);
        return;
      }
      setSelectedId('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  async function toggleSignOff(dispatchId: string, role: string) {
    setSigningRole({ dispatchId, role });
    try {
      const res = await fetch(`/api/engagements/${engagementId}/questionnaire-dispatch?id=${encodeURIComponent(dispatchId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signOffRole: role }),
      });
      if (res.ok) {
        const data = await res.json();
        setDispatches(prev => prev.map(d => d.id === dispatchId
          ? { ...d, metadata: { ...(d.metadata || {}), signOffs: data.signOffs } }
          : d));
      }
    } finally {
      setSigningRole(null);
    }
  }

  function formatDate(iso?: string | null) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return '—'; }
  }

  function statusPill(status: string) {
    const cls = status === 'outstanding' ? 'bg-red-100 text-red-700 border-red-200'
      : status === 'chat_replied' ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-green-100 text-green-700 border-green-200';
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{status}</span>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <MessageCircle className="h-4 w-4 text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-800">Send questionnaire to client portal</h3>
        <span className="text-[11px] text-slate-400">({tabLabel})</span>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">Pick a questionnaire</label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            disabled={loading || sending}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="">{loading ? 'Loading…' : options.length === 0 ? 'No questionnaires configured' : '— Choose —'}</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}{o.auditType !== 'ALL' ? ` · ${o.auditType.split('_')[0]}` : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={send}
          disabled={!selectedId || sending}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send to Portal
        </button>
      </div>

      {error && <div className="text-[11px] text-red-600 mb-2">{error}</div>}

      {/* Dispatched questionnaires for this tab */}
      <div className="space-y-2">
        {!loading && dispatches.length === 0 && (
          <div className="text-[11px] text-slate-400 italic">No questionnaires dispatched from this tab yet.</div>
        )}
        {dispatches.map(d => {
          const isExpanded = expanded === d.id;
          const signOffs = (d.metadata?.signOffs || {}) as any;
          return (
            <div key={d.id} className="border border-slate-200 rounded">
              <button
                type="button"
                onClick={() => setExpanded(prev => prev === d.id ? null : d.id)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left"
              >
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="flex-1 text-xs font-medium text-slate-800 truncate">
                  {d.metadata?.questionnaireName || '(Questionnaire)'}
                </span>
                {statusPill(d.status)}
                <span className="text-[10px] text-slate-400">sent {formatDate(d.requestedAt)}</span>
                {/* Sign-off dots inline so the row's status is visible
                    without expanding. Click stops propagation so the
                    expand toggle doesn't fire at the same time. */}
                <div onClick={e => e.stopPropagation()}>
                  <SignOffDots
                    signOffs={signOffs}
                    teamMembers={teamMembers}
                    currentUserId={currentUserId}
                    onToggle={(role) => { if (!signingRole) toggleSignOff(d.id, role); }}
                    size="sm"
                    hideRoleLabels
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-200 px-3 py-2 space-y-2 bg-slate-50/40">
                  {d.respondedByName && (
                    <div className="text-[11px] text-slate-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      Responded by <strong>{d.respondedByName}</strong> on {formatDate(d.respondedAt)}
                    </div>
                  )}
                  {d.response && (
                    <div className="text-[11px] text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded p-2">
                      {d.response}
                    </div>
                  )}
                  {Array.isArray(d.chatHistory) && d.chatHistory.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {d.chatHistory.map((m, mi) => (
                        <div key={mi} className={`flex ${m.from === 'client' ? 'justify-end pl-12' : 'justify-start pr-12'}`}>
                          <div className={`max-w-[80%] px-2 py-1 rounded text-[11px] ${
                            m.from === 'client' ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-800'
                          }`}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-semibold text-[9px]">{m.name}</span>
                              <span className="text-[8px] text-slate-400">{new Date(m.timestamp).toLocaleString('en-GB')}</span>
                            </div>
                            <p className="whitespace-pre-wrap">{m.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!d.response && (!d.chatHistory || d.chatHistory.length === 0) && (
                    <div className="text-[11px] text-slate-400 italic">Waiting on client response…</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
