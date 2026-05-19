'use client';

import { useState, useEffect } from 'react';
import { Send, Mail, MessageCircle, Loader2, CheckCircle2, X, Zap } from 'lucide-react';
import type { InfoRequestData } from '@/hooks/useEngagement';
import type { InfoRequestType } from '@/types/methodology';
import { useAutoSave } from '@/hooks/useAutoSave';
import { LIST_ACTION_LABELS, LIST_ACTION_KINDS, type ListAction } from '@/lib/list-template-actions';

interface Props {
  engagementId: string;
  initialRequests: InfoRequestData[];
  infoRequestType: InfoRequestType;
  hardCloseDate: string | null;
  periodEndDate: string | null;
  onTypeChange: (type: InfoRequestType) => void;
  onHardCloseDateChange: (date: string | null) => void;
}

interface RunResult { ok: boolean; message: string; at: number }

export function InfoRequestPanel({
  engagementId,
  initialRequests,
  infoRequestType,
  hardCloseDate,
  periodEndDate,
  onTypeChange,
  onHardCloseDateChange,
}: Props) {
  const [requests, setRequests] = useState<InfoRequestData[]>(initialRequests);
  const [newItem, setNewItem] = useState('');
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, RunResult>>({});
  // Third-party email modal — only used when the row's action is
  // 'third_party'. Tracks which row triggered it so we can fire the
  // run-action endpoint with the right itemId after the auditor
  // confirms the recipient.
  const [thirdPartyFor, setThirdPartyFor] = useState<InfoRequestData | null>(null);
  const [thirdPartyEmail, setThirdPartyEmail] = useState('');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [thirdPartyMessage, setThirdPartyMessage] = useState('');
  const [thirdPartySending, setThirdPartySending] = useState(false);

  useEffect(() => { setRequests(initialRequests); }, [initialRequests]);

  const { saving, lastSaved } = useAutoSave(
    `/api/engagements/${engagementId}/info-requests`,
    { requests },
    { enabled: requests !== initialRequests }
  );

  function toggleIncluded(index: number) {
    setRequests(prev => prev.map((r, i) => i === index ? { ...r, isIncluded: !r.isIncluded } : r));
  }

  function removeItem(index: number) {
    setRequests(prev => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    if (!newItem.trim()) return;
    setRequests(prev => [...prev, {
      id: '',
      description: newItem.trim(),
      isIncluded: true,
      sortOrder: prev.length,
      action: null,
      lastActionAt: null,
    }]);
    setNewItem('');
  }

  function updateDescription(index: number, value: string) {
    setRequests(prev => prev.map((r, i) => i === index ? { ...r, description: value } : r));
  }

  function updateAction(index: number, action: ListAction | null) {
    setRequests(prev => prev.map((r, i) => i === index ? { ...r, action } : r));
  }

  // Replace placeholder text in descriptions
  function getDisplayText(description: string): string {
    if (description.includes('[Hard Close Date]') && hardCloseDate) {
      return description.replace('[Hard Close Date]', new Date(hardCloseDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
    if (description.includes('[Client Period End]') && periodEndDate) {
      return description.replace('[Client Period End]', new Date(periodEndDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
    return description;
  }

  async function runItem(req: InfoRequestData) {
    if (!req.id) {
      // Newly-added rows haven't been persisted yet — running them
      // would 404 because there's no DB id. The autosave will mint
      // one in ~1s; nudge the auditor to retry then.
      setResults(prev => ({ ...prev, ['new']: { ok: false, message: 'Save in progress — try Run again in a moment.', at: Date.now() } }));
      return;
    }
    const action = req.action as ListAction | null | undefined;
    if (!action) return;

    if (action === 'third_party') {
      setThirdPartyFor(req);
      setThirdPartyEmail('');
      setThirdPartyName('');
      setThirdPartyMessage('');
      return;
    }

    await actuallyRun(req, action, {});
  }

  async function actuallyRun(req: InfoRequestData, action: ListAction, extra: Record<string, string>) {
    setRunning(prev => ({ ...prev, [req.id]: true }));
    try {
      const res = await fetch(`/api/engagements/${engagementId}/info-requests/run-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: req.id, action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResults(prev => ({ ...prev, [req.id]: { ok: false, message: data?.error || `Failed (${res.status})`, at: Date.now() } }));
        return false;
      }
      // Echo success message based on the action kind so the auditor
      // gets a concrete confirmation, not just "OK".
      let msg = 'Sent.';
      if (action === 'request_portal') msg = 'Portal request sent.';
      else if (action === 'message_client') msg = data?.interpretation === 'team_notification' ? 'Team notification sent to portal.' : 'Message sent to portal.';
      else if (action === 'third_party') msg = `Email sent to ${data?.to || extra.thirdPartyEmail}.`;
      setResults(prev => ({ ...prev, [req.id]: { ok: true, message: msg, at: Date.now() } }));
      // Optimistic local stamp so the row reflects "sent" without a
      // round-trip to refresh the engagement payload.
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, lastActionAt: new Date().toISOString() } : r));
      return true;
    } catch (err: any) {
      setResults(prev => ({ ...prev, [req.id]: { ok: false, message: err?.message || 'Network error', at: Date.now() } }));
      return false;
    } finally {
      setRunning(prev => ({ ...prev, [req.id]: false }));
    }
  }

  async function confirmThirdParty() {
    if (!thirdPartyFor) return;
    if (!/.+@.+\..+/.test(thirdPartyEmail.trim())) return;
    setThirdPartySending(true);
    const ok = await actuallyRun(thirdPartyFor, 'third_party', {
      thirdPartyEmail: thirdPartyEmail.trim(),
      thirdPartyName: thirdPartyName.trim(),
      thirdPartyMessage: thirdPartyMessage.trim(),
    });
    setThirdPartySending(false);
    if (ok) setThirdPartyFor(null);
  }

  function ActionIcon({ action }: { action: ListAction | null | undefined }) {
    if (action === 'request_portal') return <Send className="h-3 w-3" />;
    if (action === 'message_client') return <MessageCircle className="h-3 w-3" />;
    if (action === 'third_party') return <Mail className="h-3 w-3" />;
    return <Zap className="h-3 w-3" />;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Initial Information Request</h3>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
        </div>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="radio"
            checked={infoRequestType === 'standard'}
            onChange={() => onTypeChange('standard')}
            className="w-3 h-3"
          />
          <span className={infoRequestType === 'standard' ? 'text-blue-600 font-medium' : 'text-slate-500'}>Standard</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="radio"
            checked={infoRequestType === 'preliminary'}
            onChange={() => onTypeChange('preliminary')}
            className="w-3 h-3"
          />
          <span className={infoRequestType === 'preliminary' ? 'text-blue-600 font-medium' : 'text-slate-500'}>Preliminary Hard Close</span>
        </label>

        {infoRequestType === 'preliminary' && (
          <div className="flex items-center gap-1.5 ml-4">
            <label className="text-xs text-slate-500">Hard Close Date:</label>
            <input
              type="date"
              value={hardCloseDate?.split('T')[0] || ''}
              onChange={e => onHardCloseDateChange(e.target.value || null)}
              className="border border-slate-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        )}
      </div>

      {/* Item List */}
      <div className="space-y-1 max-h-[320px] overflow-auto mb-2">
        {requests.map((req, i) => {
          const action = (req.action as ListAction | null | undefined) ?? null;
          const result = results[req.id];
          return (
            <div key={req.id || `new-${i}`} className="flex items-center gap-2 py-0.5 group">
              <input
                type="checkbox"
                checked={req.isIncluded}
                onChange={() => toggleIncluded(i)}
                className="w-3 h-3 rounded"
              />
              <input
                type="text"
                value={req.description}
                onChange={e => updateDescription(i, e.target.value)}
                className={`flex-1 text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 ${
                  !req.isIncluded ? 'text-slate-300 line-through' : 'text-slate-700'
                }`}
              />
              {/* Per-row action picker. Seeds from the firm's Schedule
                  Designer (list-level default + per-item override) but
                  the auditor can change it here on a per-engagement
                  basis without affecting the firm template. */}
              <select
                value={action ?? ''}
                onChange={e => updateAction(i, (e.target.value || null) as ListAction | null)}
                className={`text-[10px] border rounded px-1 py-0.5 bg-white ${
                  action ? 'border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-400'
                }`}
                title={action ? `Action: ${LIST_ACTION_LABELS[action]}` : 'No action set'}
              >
                <option value="">— No action —</option>
                {LIST_ACTION_KINDS.map(k => (
                  <option key={k} value={k}>{LIST_ACTION_LABELS[k]}</option>
                ))}
              </select>
              <button
                onClick={() => runItem(req)}
                disabled={!action || running[req.id]}
                className={`inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded ${
                  action ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-50 text-slate-300 cursor-not-allowed'
                } disabled:opacity-50`}
                title={action ? `Run "${LIST_ACTION_LABELS[action]}" for this item` : 'Pick an action first'}
              >
                {running[req.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <ActionIcon action={action} />}
                Run
              </button>
              {req.lastActionAt && (
                <span className="text-[9px] text-slate-400" title={`Last run: ${new Date(req.lastActionAt).toLocaleString('en-GB')}`}>
                  <CheckCircle2 className="h-2.5 w-2.5 inline text-green-500" />
                </span>
              )}
              <button
                onClick={() => removeItem(i)}
                className="text-red-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100"
              >
                ×
              </button>
              {result && (
                <span className={`text-[9px] ml-1 ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {result.message}
                </span>
              )}
              <span className="text-[10px] text-slate-300 hidden group-hover:inline">
                {getDisplayText(req.description) !== req.description ? getDisplayText(req.description) : ''}
              </span>
            </div>
          );
        })}
      </div>

      {/* Add New Item */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="Add new item..."
          className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <button
          onClick={addItem}
          disabled={!newItem.trim()}
          className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Third-party email modal */}
      {thirdPartyFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => !thirdPartySending && setThirdPartyFor(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-600" /> Issue to Third Party
              </h3>
              <button onClick={() => !thirdPartySending && setThirdPartyFor(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="text-xs text-slate-600">
                Sending information request: <strong>{thirdPartyFor.description}</strong>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Recipient email *</label>
                <input
                  type="email"
                  value={thirdPartyEmail}
                  onChange={e => setThirdPartyEmail(e.target.value)}
                  placeholder="someone@thirdparty.com"
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Recipient name (optional)</label>
                <input
                  type="text"
                  value={thirdPartyName}
                  onChange={e => setThirdPartyName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Extra message (optional)</label>
                <textarea
                  value={thirdPartyMessage}
                  onChange={e => setThirdPartyMessage(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  placeholder="Any additional context for the recipient…"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                onClick={() => setThirdPartyFor(null)}
                disabled={thirdPartySending}
                className="text-xs px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded"
              >Cancel</button>
              <button
                onClick={confirmThirdParty}
                disabled={thirdPartySending || !/.+@.+\..+/.test(thirdPartyEmail.trim())}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {thirdPartySending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                Send email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
