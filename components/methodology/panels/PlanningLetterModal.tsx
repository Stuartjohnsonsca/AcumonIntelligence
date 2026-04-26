'use client';

import { useEffect, useState } from 'react';
import { X, Send, Download, Loader2, AlertTriangle, CheckCircle2, FileText, Mail } from 'lucide-react';

/**
 * PlanningLetterModal — dropdown popup triggered from the RMM tab.
 *
 * Two modes:
 *   • `send`     — picks a document template AND an email template.
 *                  Server renders both, uploads the .docx to the
 *                  portal, emails the Informed Management contacts
 *                  with the .docx attached and the covering email.
 *   • `download` — picks a document template only. Server renders
 *                  the .docx and streams it to the browser.
 *
 * The Informed-Management + portal-access gate lives server-side;
 * when the server returns 422 with `reason='no_informed_management_with_portal_access'`
 * we surface the explanation and disable the Send button until the
 * admin fixes the contacts.
 */

interface Props {
  mode: 'send' | 'download';
  engagementId: string;
  onClose: () => void;
}

interface TemplateOption { id: string; name: string; description: string | null; category: string; kind: string }

interface SendResponse {
  ok?: boolean;
  portalDocumentId?: string;
  fileName?: string;
  subject?: string;
  sentCount?: number;
  failedCount?: number;
  recipients?: Array<{ id: string; name: string; email: string; status: 'sent' | 'failed'; messageId?: string; error?: string }>;
  error?: string;
  reason?: string;
  detail?: string;
}

const PLANNING_LETTER_CATEGORY = 'audit_planning_letter';

export function PlanningLetterModal({ mode, engagementId, onClose }: Props) {
  const [docTemplates, setDocTemplates] = useState<TemplateOption[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<TemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  const [selectedDocId, setSelectedDocId] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState('');

  // Recipient preview — fetched once for the send flow so the admin
  // can see who the email will go to BEFORE they hit Send. Also used
  // as a fast-path to show the "no Informed Management with portal
  // access" hint without waiting for the server round-trip.
  const [recipients, setRecipients] = useState<Array<{ id: string; name: string; email: string; hasPortalAccess: boolean }>>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SendResponse | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // ── Load planning-letter templates for both kinds ────────────────
  useEffect(() => {
    setLoadingTemplates(true);
    (async () => {
      try {
        const [docsRes, emailsRes] = await Promise.all([
          fetch(`/api/methodology-admin/template-documents?kind=document`),
          fetch(`/api/methodology-admin/template-documents?kind=email`),
        ]);
        const [docs, emails] = await Promise.all([docsRes.json(), emailsRes.json()]);
        const docList = (Array.isArray(docs) ? docs : []).filter((t: any) => t.category === PLANNING_LETTER_CATEGORY && t.isActive !== false);
        const emailList = (Array.isArray(emails) ? emails : []).filter((t: any) => t.category === PLANNING_LETTER_CATEGORY && t.isActive !== false);
        setDocTemplates(docList);
        setEmailTemplates(emailList);
        // Auto-select when there's only one option — common case.
        if (docList.length === 1) setSelectedDocId(docList[0].id);
        if (emailList.length === 1) setSelectedEmailId(emailList[0].id);
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, []);

  // ── Load recipient preview for send mode ─────────────────────────
  useEffect(() => {
    if (mode !== 'send') return;
    setRecipientsLoading(true);
    (async () => {
      try {
        const [contactsRes, engagementRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/contacts`),
          fetch(`/api/engagements/${engagementId}`),
        ]);
        if (!contactsRes.ok) return;
        const { contacts } = await contactsRes.json();
        const engagement = engagementRes.ok ? await engagementRes.json() : null;
        const clientId = engagement?.clientId || engagement?.engagement?.clientId;
        // Check portal access: look up ClientPortalUser rows for this
        // client and match by email. Mirror what the server does.
        let portalEmails = new Set<string>();
        if (clientId) {
          try {
            const pu = await fetch(`/api/portal/users?clientId=${clientId}`);
            if (pu.ok) {
              const puData = await pu.json();
              const users: any[] = puData.users || puData || [];
              portalEmails = new Set(users.filter(u => u.isActive !== false).map((u: any) => (u.email || '').toLowerCase()));
            }
          } catch { /* tolerant */ }
        }
        const informedMgmt = (contacts as any[])
          .filter(c => c.isInformedManagement && c.email)
          .map(c => ({
            id: c.id,
            name: c.name,
            email: c.email as string,
            hasPortalAccess: portalEmails.has(String(c.email).toLowerCase()),
          }));
        setRecipients(informedMgmt);
      } finally {
        setRecipientsLoading(false);
      }
    })();
  }, [mode, engagementId]);

  const eligibleRecipients = recipients.filter(r => r.hasPortalAccess);
  const gateFailsPreflight = mode === 'send' && !recipientsLoading && eligibleRecipients.length === 0;

  /** When the send-permission gate trips, the server returns 403 with
   *  `reason: 'permission_not_ready'`. The user's spec is a simple
   *  popup with just an OK button — using window.alert() here matches
   *  that shape exactly without bringing in another nested modal.
   *  Returns true if the response was a permission failure (so the
   *  caller can short-circuit before treating it as a generic error). */
  function trySurfacePermissionPopup(res: Response, data: any): boolean {
    if (res.status !== 403 || data?.reason !== 'permission_not_ready') return false;
    if (typeof window !== 'undefined') {
      const detail = data?.detail ? `\n\n${data.detail}` : '';
      window.alert(`Permission to Send not Ready${detail}`);
    }
    return true;
  }

  async function handleSend() {
    if (!selectedDocId || !selectedEmailId) return;
    setSubmitting(true);
    setErrorDetail(null);
    setResult(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/send-planning-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentTemplateId: selectedDocId, emailTemplateId: selectedEmailId }),
      });
      const data: SendResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (trySurfacePermissionPopup(res, data)) return;
        setErrorDetail(data.detail || data.error || `Send failed (${res.status})`);
        setResult(data);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setErrorDetail(err?.message || 'Send failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload() {
    if (!selectedDocId) return;
    setSubmitting(true);
    setErrorDetail(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/download-planning-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedDocId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (trySurfacePermissionPopup(res, err)) return;
        setErrorDetail(err.error || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const matched = cd.match(/filename="([^"]+)"/);
      const fileName = matched?.[1] || 'planning-letter.docx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Close modal after successful download.
      onClose();
    } catch (err: any) {
      setErrorDetail(err?.message || 'Download failed');
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === 'send' ? 'Send Planning Letter' : 'Download Planning Letter';
  const Icon = mode === 'send' ? Send : Download;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => { if (!submitting) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Icon className={`h-4 w-4 ${mode === 'send' ? 'text-blue-600' : 'text-slate-600'}`} />
            {title}
          </h3>
          <button onClick={() => !submitting && onClose()} className="text-slate-400 hover:text-slate-600" disabled={submitting}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ── Success result ────────────────────────────────────── */}
          {result?.ok && mode === 'send' && (
            <div className="border border-green-200 bg-green-50 rounded p-3 text-xs">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-green-800 mb-1">Planning Letter sent</div>
                  <div className="text-green-700">
                    Uploaded to the Client Portal and emailed to {result.sentCount} recipient{result.sentCount === 1 ? '' : 's'}.
                    {(result.failedCount ?? 0) > 0 && <> {result.failedCount} failed — see below.</>}
                  </div>
                  {result.recipients && result.recipients.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {result.recipients.map(r => (
                        <li key={r.id} className={`flex items-center gap-1.5 ${r.status === 'sent' ? 'text-green-700' : 'text-red-700'}`}>
                          {r.status === 'sent' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          <span className="font-medium">{r.name}</span>
                          <span className="text-slate-500">&lt;{r.email}&gt;</span>
                          {r.error && <span className="text-red-600">— {r.error}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Error — the Informed-Management gate or other failure ── */}
          {errorDetail && (
            <div className="border border-red-200 bg-red-50 rounded p-3 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-red-800 mb-1">Cannot send Planning Letter</div>
                  <div className="text-red-700">{errorDetail}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Pre-flight gate warning (no recipients before submit) ── */}
          {mode === 'send' && gateFailsPreflight && !errorDetail && !result && (
            <div className="border border-amber-200 bg-amber-50 rounded p-3 text-xs">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-amber-800 mb-1">No recipient available</div>
                  <div className="text-amber-700">
                    {recipients.length === 0
                      ? 'No contacts on this engagement are flagged as Informed Management. Tick at least one contact as Informed Management, make sure they have Portal Access, and try again.'
                      : 'One or more contacts are flagged as Informed Management, but none of them have Client Portal access. Grant Portal Access to at least one Informed Management contact and try again.'}
                  </div>
                  <div className="text-[10px] text-amber-600 mt-1">Open the Opening tab &rarr; Client Contacts to fix this.</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Template pickers ─────────────────────────────────── */}
          {!result?.ok && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  <FileText className="h-3 w-3 inline mr-1" /> Planning Letter document template
                </label>
                {loadingTemplates ? (
                  <div className="text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Loading…</div>
                ) : docTemplates.length === 0 ? (
                  <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded p-2">
                    No document template with category <code className="text-[10px] bg-white border rounded px-1">audit_planning_letter</code> found.
                    Create one in Methodology Admin &rarr; Template Documents &rarr; Documents and set its category to &ldquo;Audit Planning Letter&rdquo;.
                  </div>
                ) : (
                  <select
                    value={selectedDocId}
                    onChange={e => setSelectedDocId(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                  >
                    <option value="">— Select a template —</option>
                    {docTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {mode === 'send' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    <Mail className="h-3 w-3 inline mr-1" /> Covering email template
                  </label>
                  {loadingTemplates ? (
                    <div className="text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Loading…</div>
                  ) : emailTemplates.length === 0 ? (
                    <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded p-2">
                      No email template with category <code className="text-[10px] bg-white border rounded px-1">audit_planning_letter</code> found.
                      Create one in Methodology Admin &rarr; Template Documents &rarr; Emails and set its category to &ldquo;Audit Planning Letter&rdquo;.
                    </div>
                  ) : (
                    <select
                      value={selectedEmailId}
                      onChange={e => setSelectedEmailId(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                    >
                      <option value="">— Select a template —</option>
                      {emailTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Recipient preview for send mode */}
              {mode === 'send' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Recipients (Informed Management with Portal Access)</label>
                  {recipientsLoading ? (
                    <div className="text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Loading…</div>
                  ) : recipients.length === 0 ? (
                    <div className="text-xs text-slate-400 italic border border-dashed border-slate-200 rounded p-2">
                      No Informed Management contacts on this engagement.
                    </div>
                  ) : (
                    <ul className="border border-slate-200 rounded divide-y divide-slate-100 text-xs">
                      {recipients.map(r => (
                        <li key={r.id} className="flex items-center gap-2 px-2 py-1.5">
                          {r.hasPortalAccess
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                            : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
                          <span className="font-medium text-slate-700">{r.name}</span>
                          <span className="text-slate-500 text-[11px]">&lt;{r.email}&gt;</span>
                          {!r.hasPortalAccess && <span className="ml-auto text-[10px] text-amber-600">no portal access</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-800">
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
          {!result?.ok && mode === 'send' && (
            <button
              onClick={handleSend}
              disabled={submitting || !selectedDocId || !selectedEmailId || gateFailsPreflight}
              className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send to Informed Management
            </button>
          )}
          {!result?.ok && mode === 'download' && (
            <button
              onClick={handleDownload}
              disabled={submitting || !selectedDocId}
              className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50 font-medium"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Download .docx
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
