'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { expandZipFile } from '@/lib/client-unzip';
import { TABS } from '@/components/methodology/engagement-tabs-list';

// Lookup helpers for the live engagement-tab list. Used to render the
// 'Allocated to' badge on each document row and to drive the location
// filter dropdown — both stay in lockstep with whatever tabs the
// engagement actually has rather than a hard-coded "audit phase" list.
const TAB_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(TABS.map(t => [t.key, t.label]));
function tabLabelForKey(key: string | null | undefined): string {
  if (!key) return '';
  return TAB_LABEL_BY_KEY[key] || key;
}

interface Props {
  engagementId: string;
}

interface AuditDocument {
  id: string;
  documentName: string;
  requestedFrom: string | null;
  requestedDate: string | null;
  requestedBy: { id: string; name: string } | null;
  uploadedDate: string | null;
  uploadedBy: { id: string; name: string } | null;
  storagePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  visibleToClient: boolean;
  receivedByName: string | null;
  receivedAt: string | null;
  verifiedOn: string | null;
  verifiedByName: string | null;
  utilisedOn: string | null;
  utilisedByName: string | null;
  utilisedTab: string | null;
  /** Multi-tab allocation list — union of utilisedTab + the join
   *  table — surfaced flat by the API. */
  utilisedTabs?: string[];
  mappedItems: string[] | null;
  source: string | null;
  usageLocation: string | null;
  documentType: string | null;
  /** True when documentType was filled by the upload-time AI
   *  classifier and the user hasn't confirmed/edited it yet. */
  documentTypeAiSuggested?: boolean;
  createdAt: string;
}

// ─── Default category options ───
const DEFAULT_SOURCES = ['Client', 'Bank', 'Solicitor', 'HMRC', 'Companies House', 'Third Party', 'Team', 'Other'];
const DEFAULT_DOCUMENT_TYPES = ['Bank Statement', 'Bank Confirmation', 'Invoice', 'Contract', 'Lease Agreement', 'Board Minutes', 'Financial Statements', 'Tax Return', 'Payroll Report', 'Fixed Asset Register', 'Debtor Listing', 'Creditor Listing', 'Stock Listing', 'Management Accounts', 'Letter of Representation', 'Letter of Comment', 'Engagement Letter', 'Solicitor Confirmation', 'Other'];

// Documents arriving from the Import Options pop-up (uploaded prior
// audit file or carried-forward documents) are tagged with these
// markers in their `mappedItems` array. The Documents tab renders them
// in a separate "Prior Period Documents" collapsible folder.
const PRIOR_PERIOD_TAGS = ['__prior_period_archive__', '__prior_period_carried__'];
function isPriorPeriodFolderDoc(doc: AuditDocument): boolean {
  const tags = Array.isArray(doc.mappedItems) ? doc.mappedItems : [];
  return tags.some(t => PRIOR_PERIOD_TAGS.includes(t));
}

function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('en-GB') : '—'; }
function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleDateString('en-GB') + ' ' + new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'; }
// Browser-side email syntax check — same shape `<input type=email>`
// uses internally. Server-side validation is the authority; this is
// only here to drive the inline error indicator and disable the
// submit button while the field is obviously wrong.
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function DocumentRepositoryTab({ engagementId }: Props) {
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<AuditDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFrom, setNewFrom] = useState('');
  const [newMapping, setNewMapping] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newUsageLocation, setNewUsageLocation] = useState('');
  const [newDocType, setNewDocType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);

  // Generate from Template state
  const [showGenerate, setShowGenerate] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; category: string; kind?: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [generateAction, setGenerateAction] = useState<'download' | 'send_email' | 'send_portal'>('download');
  // Optional document repository attachments to include on the email
  // when generateAction === 'send_email'. The list comes from the
  // engagement's existing AuditDocument rows that have a storagePath
  // (i.e. files actually uploaded). The generated template PDF is
  // always attached automatically — this list adds extras alongside.
  const [emailAttachmentIds, setEmailAttachmentIds] = useState<string[]>([]);
  // Detail level removed from the UI per user request — the server-
  // side template engine still accepts the parameter so we always
  // pass 'detailed' (the more useful default) so the rendered audit
  // procedures don't silently strip themselves down to test names.
  const auditPlanDetail = 'detailed';
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  // Missing-fields gate. handleGenerate first calls 'check_required'
  // which returns the placeholders that resolve to empty in the live
  // engagement context; if any are present we open a popup listing
  // them grouped by section. The user can either bail out and fill
  // the data in, or click "Generate anyway" which sets this back to
  // null and re-enters handleGenerate with skipMissingCheck=true.
  const [missingFields, setMissingFields] = useState<{ key: string; label: string; group: string }[] | null>(null);

  // Custom types added by user during this engagement
  const [customDocTypes, setCustomDocTypes] = useState<string[]>([]);
  const [addingCustomType, setAddingCustomType] = useState(false);
  const [customTypeInput, setCustomTypeInput] = useState('');

  // Request-form state additions: FS line picker + delivery method +
  // live portal-user check. fsLines populates from the new
  // /api/firm/fs-lines endpoint on mount; selectedFsLineIds is the
  // multi-select state for the request.
  const [fsLines, setFsLines] = useState<{ id: string; name: string; fsCategory: string; fsLevelName: string | null; fsStatementName: string | null }[]>([]);
  const [selectedFsLineIds, setSelectedFsLineIds] = useState<string[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<'portal' | 'email' | 'download'>('portal');
  const [portalCheck, setPortalCheck] = useState<{ status: 'idle' | 'checking' | 'ok' | 'missing'; message?: string }>({ status: 'idle' });

  // Filters
  const [filterSource, setFilterSource] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterDocType, setFilterDocType] = useState('');

  // Prior Period Documents folder is collapsed by default and only
  // rendered when at least one document carries a prior-period tag.
  const [priorPeriodFolderOpen, setPriorPeriodFolderOpen] = useState(false);

  // Derive all available types (defaults + customs from data + customs added this session)
  const allDocTypes = [...new Set([...DEFAULT_DOCUMENT_TYPES, ...customDocTypes, ...documents.map(d => d.documentType).filter(Boolean) as string[]])].sort();
  const allSources = [...new Set([...DEFAULT_SOURCES, ...documents.map(d => d.source).filter(Boolean) as string[]])].sort();
  // Location filter mirrors the live engagement tabs — picking 'Ethics'
  // shows only docs allocated (utilisedTab) to the Ethics tab. Tabs
  // that no document references yet still appear so the user can
  // scan-through the list visually.
  const locationFilterOptions = TABS.map(t => ({ key: t.key, label: t.label }));
  // Per-document `usageLocation` editor still uses free-text category
  // values — these are auditor-friendly groupings (e.g. "General",
  // "Audit Plan") rather than tab keys. Seed with live tab labels +
  // any extant values so admins don't need to retype.
  const allLocations = [
    ...new Set([
      ...TABS.map(t => t.label),
      ...documents.map(d => d.usageLocation).filter(Boolean) as string[],
    ]),
  ].sort();

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`);
      if (res.ok) { const data = await res.json(); setDocuments(data.documents || []); }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // Load the firm's FS lines once for the Mapped-to dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/firm/fs-lines');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setFsLines(Array.isArray(data?.fsLines) ? data.fsLines : []);
        }
      } catch { /* tolerant — dropdown stays empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced portal-user check — fires whenever the user types into
  // the Requested To field while the delivery method is 'portal'. The
  // server returns isPortalUser true/false; we surface the reason
  // string inline. No-op for 'email' / 'download' delivery.
  useEffect(() => {
    if (!showForm) return;
    if (deliveryMethod !== 'portal') {
      setPortalCheck({ status: 'idle' });
      return;
    }
    const email = newFrom.trim();
    if (!email || !isValidEmail(email)) {
      setPortalCheck({ status: 'idle' });
      return;
    }
    setPortalCheck({ status: 'checking' });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/portal-user-check?email=${encodeURIComponent(email)}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data?.isPortalUser) {
            setPortalCheck({ status: 'ok', message: data.portalUserName ? `Will deliver via portal to ${data.portalUserName}` : 'Recipient is registered on the portal' });
          } else {
            setPortalCheck({ status: 'missing', message: data?.reason || 'Recipient is not a Client Portal user' });
          }
        }
      } catch { /* tolerant */ }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [engagementId, newFrom, deliveryMethod, showForm]);

  async function postAction(body: Record<string, unknown>) {
    await fetch(`/api/engagements/${engagementId}/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await loadDocuments();
  }

  async function requestDocument() {
    if (!newName.trim()) return;
    if (deliveryMethod === 'portal' && portalCheck.status === 'missing') {
      // Server would reject this anyway; bail early so the user
      // doesn't lose the form. The inline flag has already explained
      // why.
      return;
    }
    setSubmitting(true);
    // Map FS line ids → names for the legacy mappedItems string[] —
    // existing renderers display the strings directly. Fall back to
    // the comma-separated free-text the input still allows so prior
    // requests keep working.
    const fsLineNames = selectedFsLineIds
      .map(id => fsLines.find(l => l.id === id)?.name)
      .filter(Boolean) as string[];
    const freeTextItems = newMapping ? newMapping.split(',').map(s => s.trim()).filter(Boolean) : [];
    const mappedItems = fsLineNames.length > 0 ? fsLineNames : freeTextItems.length > 0 ? freeTextItems : null;

    const res = await fetch(`/api/engagements/${engagementId}/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        documentName: newName.trim(),
        requestedFrom: newFrom.trim() || null,
        mappedItems,
        source: newSource || null,
        usageLocation: newUsageLocation || null,
        documentType: newDocType || null,
        deliveryMethod,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Server returns portalUserMissing when the email isn't a
      // Client Portal user — surface the message inline.
      if (data?.portalUserMissing) {
        setPortalCheck({ status: 'missing', message: data.error || 'Recipient is not a Client Portal user' });
      } else {
        // Generic alert for now; could be a toast.
        alert(data?.error || `Request failed (${res.status})`);
      }
      setSubmitting(false);
      return;
    }
    await loadDocuments();
    setNewName(''); setNewFrom(''); setNewMapping(''); setNewSource(''); setNewUsageLocation(''); setNewDocType('');
    setSelectedFsLineIds([]);
    setDeliveryMethod('portal');
    setPortalCheck({ status: 'idle' });
    setShowForm(false); setSubmitting(false);
  }

  async function handleFileUpload(docId: string, file: File) {
    setUploadingDocId(docId);
    await postAction({ action: 'upload', documentId: docId, fileSize: file.size, mimeType: file.type, storagePath: `uploads/${docId}/${file.name}` });
    setUploadingDocId(null);
  }

  async function deleteDocument(docId: string) {
    await fetch(`/api/engagements/${engagementId}/documents`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: docId }),
    });
    await loadDocuments();
  }

  async function updateCategory(docId: string, field: 'source' | 'usageLocation' | 'documentType', value: string) {
    await postAction({ action: 'update_categories', documentId: docId, [field]: value || null });
  }

  // Load templates when Generate panel opens
  async function loadTemplates() {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/generate-document`);
      if (res.ok) { const data = await res.json(); setTemplates(data.templates || []); }
    } catch { /* ignore */ }
  }

  async function handleGenerate(skipMissingCheck = false) {
    if (!selectedTemplate) return;
    setGenerating(true);
    setGenerateResult(null);
    try {
      // Pre-flight missing-fields check. Hits the same route with a
      // 'check_required' action — much cheaper than a full PDF render
      // because we just resolve paths and never invoke the renderer.
      // If anything is empty we surface the popup and bail; the user
      // can either close + fill the data in, or click "Generate
      // anyway" which re-enters this function with skipMissingCheck=true.
      if (!skipMissingCheck) {
        try {
          const checkRes = await fetch(`/api/engagements/${engagementId}/generate-document`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: selectedTemplate, action: 'check_required' }),
          });
          if (checkRes.ok) {
            const data = await checkRes.json();
            const missing = Array.isArray(data?.missing) ? data.missing : [];
            if (missing.length > 0) {
              setMissingFields(missing);
              setGenerating(false);
              return;
            }
          }
        } catch { /* tolerant — fall through and let the generate call surface any real error */ }
      }
      const body: Record<string, unknown> = { templateId: selectedTemplate, action: generateAction, auditPlanDetail };
      if (generateAction === 'send_email') {
        body.recipientEmail = recipientEmail;
        body.recipientName = recipientName;
        if (emailAttachmentIds.length > 0) body.attachmentDocumentIds = emailAttachmentIds;
      }

      if (generateAction === 'download') {
        const res = await fetch(`/api/engagements/${engagementId}/generate-document`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action: 'preview' }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `document.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          setGenerateResult('PDF downloaded and saved to Document Repository');
          loadDocuments();
        } else {
          setGenerateResult('Failed to generate PDF');
        }
      } else {
        const res = await fetch(`/api/engagements/${engagementId}/generate-document`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) {
          setGenerateResult(generateAction === 'send_email' ? 'Email sent successfully' : 'Pushed to client portal');
          loadDocuments();
        } else {
          const data = await res.json().catch(() => ({}));
          setGenerateResult(`Failed: ${data.error || res.status}`);
        }
      }
    } catch (err: any) { setGenerateResult(`Error: ${err.message}`); }
    finally { setGenerating(false); }
  }

  function addCustomDocType() {
    const t = customTypeInput.trim();
    if (!t || allDocTypes.includes(t)) return;
    setCustomDocTypes(prev => [...prev, t]);
    setNewDocType(t);
    setCustomTypeInput('');
    setAddingCustomType(false);
  }

  // Apply filters. Location matches against ANY of the document's
  // tab allocations (utilisedTabs is the union of the legacy
  // utilisedTab + the join table). That's what the user actually
  // asks "where is this document referenced from?" with.
  const filtered = documents.filter(doc => {
    if (filterSource && doc.source !== filterSource) return false;
    if (filterLocation) {
      const allocations = doc.utilisedTabs && doc.utilisedTabs.length > 0
        ? doc.utilisedTabs
        : (doc.utilisedTab ? [doc.utilisedTab] : []);
      if (!allocations.includes(filterLocation)) return false;
    }
    if (filterDocType && doc.documentType !== filterDocType) return false;
    return true;
  });

  const hasActiveFilters = filterSource || filterLocation || filterDocType;

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Documents...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-800">Document Repository</h2>
        <div className="flex gap-2">
          <button onClick={() => { setShowGenerate(!showGenerate); setShowForm(false); if (!showGenerate) loadTemplates(); }}
            className="text-xs px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 font-medium">
            Generate from Template
          </button>
          <button onClick={() => { setShowForm(!showForm); setShowGenerate(false); }}
            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium">
            + Request Document
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Filter:</span>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className={`text-[10px] border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 ${filterSource ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>
          <option value="">All Sources</option>
          {allSources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
          className={`text-[10px] border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 ${filterLocation ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>
          <option value="">All Locations</option>
          {locationFilterOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select value={filterDocType} onChange={e => setFilterDocType(e.target.value)}
          className={`text-[10px] border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 ${filterDocType ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>
          <option value="">All Types</option>
          {allDocTypes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {hasActiveFilters && (
          <button onClick={() => { setFilterSource(''); setFilterLocation(''); setFilterDocType(''); }}
            className="text-[10px] text-red-500 hover:text-red-700 underline">Clear</button>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">
          {hasActiveFilters ? `${filtered.length} of ${documents.length}` : `${documents.length}`} document{documents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Generate from Template */}
      {showGenerate && (
        <div className="mb-4 border border-purple-200 rounded-lg p-4 bg-purple-50/30">
          <h3 className="text-sm font-medium text-slate-700 mb-2">Generate Document from Template</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Template *</label>
              <select
                value={selectedTemplate}
                onChange={e => {
                  const id = e.target.value;
                  setSelectedTemplate(id);
                  // Auto-pick a sensible action based on the chosen
                  // template's kind: emails default to Send via Email,
                  // documents default to Download PDF. The user can
                  // still override afterwards via the Action dropdown.
                  const t = templates.find(x => x.id === id);
                  if (t?.kind === 'email') setGenerateAction('send_email');
                  else if (t?.kind === 'document') setGenerateAction('download');
                }}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
              >
                <option value="">— Select template —</option>
                {(() => {
                  const emails = templates.filter(t => t.kind === 'email');
                  const docs = templates.filter(t => t.kind === 'document');
                  const other = templates.filter(t => t.kind !== 'email' && t.kind !== 'document');
                  return (
                    <>
                      {emails.length > 0 && (
                        <optgroup label="Email Templates">
                          {emails.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
                        </optgroup>
                      )}
                      {docs.length > 0 && (
                        <optgroup label="Document Templates">
                          {docs.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
                        </optgroup>
                      )}
                      {other.length > 0 && other.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
                    </>
                  );
                })()}
              </select>
              {templates.length === 0 && (
                <p className="text-[10px] text-slate-400 mt-0.5">No templates configured for this firm yet — methodology admins manage them under Methodology Admin → Document Templates.</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Action</label>
              <select value={generateAction} onChange={e => setGenerateAction(e.target.value as any)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400">
                <option value="download">Download PDF</option>
                <option value="send_email">Send via Email</option>
                <option value="send_portal">Push to Client Portal</option>
              </select>
            </div>
          </div>
          {generateAction === 'send_email' && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Recipient Name</label>
                <input type="text" value={recipientName} onChange={e => setRecipientName(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" placeholder="e.g. John Smith" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Recipient Email *</label>
                <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" placeholder="e.g. john@client.com" />
              </div>
            </div>
          )}
          {/* Attachments — only relevant when emailing. The generated
              PDF is always attached automatically; this multi-select
              lets the user add other documents already on this
              engagement (anything with file content). */}
          {generateAction === 'send_email' && (() => {
            const attachable = documents.filter(d => !!d.storagePath);
            return (
              <div className="mb-3">
                <label className="block text-xs text-slate-500 mb-1">
                  Additional attachments
                  <span className="text-slate-400 font-normal ml-1">(optional — the generated PDF is attached automatically)</span>
                </label>
                {attachable.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic">No other uploaded documents on this engagement to attach.</p>
                ) : (
                  <select
                    multiple
                    value={emailAttachmentIds}
                    onChange={e => setEmailAttachmentIds(Array.from(e.target.selectedOptions).map(o => o.value))}
                    size={Math.min(4, attachable.length)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
                  >
                    {attachable.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.documentName}
                        {d.fileSize ? ` (${(d.fileSize / 1024).toFixed(0)} KB)` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[10px] text-slate-400 mt-0.5">Hold Ctrl/Cmd to pick more than one.</p>
              </div>
            );
          })()}
          {generateResult && (
            <div className={`text-xs mb-2 p-2 rounded ${generateResult.includes('Failed') || generateResult.includes('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
              {generateResult}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => handleGenerate()}
              disabled={!selectedTemplate || generating || (generateAction === 'send_email' && !recipientEmail)}
              className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 font-medium">
              {generating ? 'Generating...' : generateAction === 'download' ? 'Generate & Download' : generateAction === 'send_email' ? 'Generate & Send Email' : 'Generate & Push to Portal'}
            </button>
            <button onClick={() => setShowGenerate(false)} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Request Form */}
      {showForm && (
        <div className="mb-4 border border-blue-200 rounded-lg p-4 bg-blue-50/30">
          <h3 className="text-sm font-medium text-slate-700 mb-2">New Document Request</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Document Name *</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="e.g. Bank Confirmation" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Requested To</label>
              <input
                type="email"
                value={newFrom}
                onChange={e => setNewFrom(e.target.value)}
                className={`w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                  newFrom && !isValidEmail(newFrom) ? 'border-red-300 bg-red-50/30' : 'border-slate-200'
                }`}
                placeholder="email@example.com"
              />
              {newFrom && !isValidEmail(newFrom) && (
                <p className="text-[10px] text-red-600 mt-0.5">Enter a valid email address</p>
              )}
              {portalCheck.status === 'checking' && (
                <p className="text-[10px] text-slate-500 mt-0.5">Checking portal access…</p>
              )}
              {portalCheck.status === 'ok' && portalCheck.message && (
                <p className="text-[10px] text-emerald-700 mt-0.5">✓ {portalCheck.message}</p>
              )}
              {portalCheck.status === 'missing' && portalCheck.message && (
                <p className="text-[10px] text-amber-700 mt-0.5">⚠ {portalCheck.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Mapped to FS line(s)</label>
              <select
                multiple
                value={selectedFsLineIds}
                onChange={e => {
                  const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                  setSelectedFsLineIds(opts);
                }}
                size={Math.min(4, Math.max(2, fsLines.length))}
                disabled={fsLines.length === 0}
                title={fsLines.length === 0 ? 'No FS lines configured for this firm — add some under Methodology Admin → FS Lines' : 'Hold Ctrl/Cmd to pick multiple lines'}
                className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50"
              >
                {fsLines.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}{l.fsLevelName ? ` — ${l.fsLevelName}` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-0.5">Hold Ctrl/Cmd to pick more than one.</p>
            </div>
          </div>

          {/* Delivery method row — drives how the request reaches the
              recipient. Portal opens a portalRequest (gated by the
              portal-user check above), Email sends an email via
              sendDocumentRequestEmail, Download just records the
              request internally. */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">How to deliver the request</label>
              <select
                value={deliveryMethod}
                onChange={e => setDeliveryMethod(e.target.value as 'portal' | 'email' | 'download')}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              >
                <option value="portal">Portal — recipient must be a Client Portal user</option>
                <option value="email">Email — send a document request email</option>
                <option value="download">Download — record the request internally only</option>
              </select>
            </div>
          </div>
          {/* Categorisation row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Source</label>
              <select value={newSource} onChange={e => setNewSource(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">— Select —</option>
                {allSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Usage Location</label>
              <select value={newUsageLocation} onChange={e => setNewUsageLocation(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">— Select —</option>
                {allLocations.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Document Type</label>
              <div className="flex gap-1">
                {addingCustomType ? (
                  <>
                    <input type="text" value={customTypeInput} onChange={e => setCustomTypeInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addCustomDocType()}
                      className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="New type..." autoFocus />
                    <button onClick={addCustomDocType} disabled={!customTypeInput.trim()} className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50">Add</button>
                    <button onClick={() => { setAddingCustomType(false); setCustomTypeInput(''); }} className="text-xs px-1 text-slate-400">×</button>
                  </>
                ) : (
                  <>
                    <select value={newDocType} onChange={e => setNewDocType(e.target.value)}
                      className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="">— Select —</option>
                      {allDocTypes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => setAddingCustomType(true)} className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded hover:bg-slate-200" title="Add custom type">+</button>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={requestDocument}
              disabled={
                !newName.trim()
                || submitting
                || (!!newFrom && !isValidEmail(newFrom))
                || (deliveryMethod !== 'download' && !newFrom.trim())
                || (deliveryMethod === 'portal' && portalCheck.status === 'missing')
              }
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
              title={
                deliveryMethod === 'portal' && portalCheck.status === 'missing'
                  ? 'Recipient is not a Client Portal user — switch to Email or Download, or invite them to the portal first.'
                  : undefined
              }
            >
              {submitting ? 'Sending...' : deliveryMethod === 'portal' ? 'Send via Portal' : deliveryMethod === 'email' ? 'Send Email Request' : 'Create Request'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Documents List */}
      {(() => {
        const priorPeriodDocs = filtered.filter(isPriorPeriodFolderDoc);
        const otherDocs = filtered.filter(d => !isPriorPeriodFolderDoc(d));
        return (
          <div className="space-y-2">
            {priorPeriodDocs.length > 0 && (
              <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50/30">
                <button
                  type="button"
                  onClick={() => setPriorPeriodFolderOpen(prev => !prev)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-amber-50 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{priorPeriodFolderOpen ? '📂' : '📁'}</span>
                    <span className="text-xs font-semibold text-amber-800">Prior Period Documents</span>
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                      {priorPeriodDocs.length} item{priorPeriodDocs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="text-[10px] text-amber-700 italic">
                    Carried forward from prior audit file
                  </span>
                </button>
                {priorPeriodFolderOpen && (
                  <div className="border-t border-amber-200 px-2 py-2 space-y-1.5 bg-white/60">
                    {priorPeriodDocs.map(doc => (
                      <div key={doc.id} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-amber-100 rounded">
                        <span className="text-amber-500 text-xs">📄</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{doc.documentName}</p>
                          <p className="text-[10px] text-slate-400">
                            {doc.uploadedDate ? fmtDate(doc.uploadedDate) : '—'}
                            {doc.fileSize ? ` • ${(doc.fileSize / 1024).toFixed(0)} KB` : ''}
                            {doc.documentType ? ` • ${doc.documentType}` : ''}
                          </p>
                        </div>
                        {doc.storagePath && (
                          <a
                            href={`/api/documents/preview?docId=${doc.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {otherDocs.length === 0 && priorPeriodDocs.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm italic border border-slate-200 rounded-lg">
                {hasActiveFilters ? 'No documents match the current filters.' : 'No documents. Click "Request Document" to begin.'}
              </div>
            ) : otherDocs.map(doc => {
          const isExpanded = expandedDoc === doc.id;
          const mappedItems = Array.isArray(doc.mappedItems) ? doc.mappedItems : [];

          // Yellow dashed border for AI-suggested types the user
          // hasn't confirmed yet. Becomes a normal border the moment
          // the user changes the type via the per-row editor.
          const aiPending = !!(doc.documentTypeAiSuggested && doc.documentType);
          return (
            <div
              key={doc.id}
              className={`rounded-lg overflow-hidden ${
                aiPending
                  ? 'border-2 border-dashed border-amber-300 bg-amber-50/30'
                  : 'border border-slate-200'
              }`}
            >
              {/* Document row */}
              <div className="flex items-center px-3 py-2.5 hover:bg-slate-50/50 gap-3">
                {/* Status dot */}
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${doc.uploadedDate ? 'bg-green-400' : 'bg-orange-400'}`} />

                {/* Name + tags */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-700">{doc.documentName}</span>
                    {doc.source && (
                      <span
                        className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-medium"
                        title={`Source: ${doc.source}`}
                      >
                        {doc.source}
                      </span>
                    )}
                    {/* Allocation — every engagement tab this document
                        is referenced from. The API surfaces utilisedTabs
                        as a flat union of utilisedTab + the join table;
                        we render one badge per tab. */}
                    {(() => {
                      const allocations = doc.utilisedTabs && doc.utilisedTabs.length > 0
                        ? doc.utilisedTabs
                        : (doc.utilisedTab ? [doc.utilisedTab] : []);
                      return allocations.map(t => (
                        <span
                          key={`alloc-${t}`}
                          className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium"
                          title={`Allocated to: ${tabLabelForKey(t)}`}
                        >
                          {tabLabelForKey(t)}
                        </span>
                      ));
                    })()}
                    {doc.usageLocation && <span className="text-[8px] bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded font-medium">{doc.usageLocation}</span>}
                    {doc.documentType && <span className="text-[8px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded font-medium">{doc.documentType}</span>}
                    {mappedItems.length > 0 && mappedItems.map((item, i) => (
                      <span key={i} className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">{item as string}</span>
                    ))}
                    {doc.fileSize && <span className="text-[10px] text-slate-400">({(doc.fileSize / 1024).toFixed(0)}KB)</span>}
                  </div>
                  {doc.requestedFrom && <p className="text-[10px] text-slate-400">From: {doc.requestedFrom}</p>}
                </div>

                {/* Visible to Client toggle */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[9px] text-slate-400">Client</span>
                  <button onClick={() => postAction({ action: 'toggle_visibility', documentId: doc.id })}
                    className={`relative w-8 h-4 rounded-full transition-colors ${doc.visibleToClient ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${doc.visibleToClient ? 'translate-x-4' : ''}`} />
                  </button>
                </div>

                {/* 3 Status dots: Received, Verified, Usable */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-400">Recv</span>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      doc.receivedAt ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300'
                    }`} title={doc.receivedAt ? `${doc.receivedByName} — ${fmtDateTime(doc.receivedAt)}` : 'Not received'}>
                      {doc.receivedAt && <span className="text-white text-[8px]">✓</span>}
                    </div>
                    {doc.receivedAt && (
                      <div className="text-center">
                        <p className="text-[6px] text-slate-500 leading-tight">{doc.receivedByName}</p>
                        <p className="text-[6px] text-slate-400 leading-tight">{fmtDate(doc.receivedAt)}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-400">Verif</span>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      doc.verifiedOn ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300'
                    }`} title={doc.verifiedOn ? `${doc.verifiedByName} — ${fmtDateTime(doc.verifiedOn)}` : 'Not verified'}>
                      {doc.verifiedOn && <span className="text-white text-[8px]">✓</span>}
                    </div>
                    {doc.verifiedOn && (
                      <div className="text-center">
                        <p className="text-[6px] text-slate-500 leading-tight">{doc.verifiedByName}</p>
                        <p className="text-[6px] text-slate-400 leading-tight">{fmtDate(doc.verifiedOn)}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-400">Used</span>
                    <button onClick={() => !doc.utilisedOn && postAction({ action: 'utilise', documentId: doc.id, tabName: '' })}
                      disabled={!!doc.utilisedOn || !doc.verifiedOn}
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                        doc.utilisedOn ? 'bg-green-500 border-green-500' :
                        doc.verifiedOn ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer' :
                        'bg-white border-slate-200 opacity-40'
                      }`} title={doc.utilisedOn ? `${doc.utilisedByName} — ${fmtDateTime(doc.utilisedOn)}${doc.utilisedTab ? ` (${doc.utilisedTab})` : ''}` : 'Mark as used'}>
                      {doc.utilisedOn && <span className="text-white text-[8px]">✓</span>}
                    </button>
                    {doc.utilisedOn && (
                      <div className="text-center">
                        <p className="text-[6px] text-slate-500 leading-tight">{doc.utilisedByName}</p>
                        <p className="text-[6px] text-slate-400 leading-tight">{fmtDate(doc.utilisedOn)}</p>
                        {doc.utilisedTab && <p className="text-[6px] text-blue-500 leading-tight">{doc.utilisedTab}</p>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload + Delete */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!doc.uploadedDate && (
                    <button onClick={() => { setUploadingDocId(doc.id); fileInputRef.current?.click(); }}
                      className="text-xs px-2 py-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100">
                      {uploadingDocId === doc.id ? '...' : 'Upload'}
                    </button>
                  )}
                  <button onClick={() => deleteDocument(doc.id)} className="text-red-400 hover:text-red-600 text-sm">×</button>
                </div>
              </div>

              {/* Expanded detail with inline category editing */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                    <div><span className="text-slate-400">Requested:</span> <span className="text-slate-600">{fmtDate(doc.requestedDate)} by {doc.requestedBy?.name || '—'}</span></div>
                    <div><span className="text-slate-400">Uploaded:</span> <span className="text-slate-600">{fmtDate(doc.uploadedDate)} by {doc.uploadedBy?.name || '—'}</span></div>
                    <div><span className="text-slate-400">From:</span> <span className="text-slate-600">{doc.requestedFrom || '—'}</span></div>
                    <div><span className="text-slate-400">File Type:</span> <span className="text-slate-600">{doc.mimeType || '—'}</span></div>
                    {mappedItems.length > 0 && (
                      <div className="col-span-2"><span className="text-slate-400">Mapped to:</span> <span className="text-slate-600">{mappedItems.join(', ')}</span></div>
                    )}
                  </div>
                  {/* Inline category editors */}
                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Source</label>
                      <select value={doc.source || ''} onChange={e => updateCategory(doc.id, 'source', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white">
                        <option value="">— None —</option>
                        {allSources.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">Usage Location</label>
                      <select value={doc.usageLocation || ''} onChange={e => updateCategory(doc.id, 'usageLocation', e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white">
                        <option value="">— None —</option>
                        {allLocations.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 font-medium">
                        Document Type
                        {aiPending && <span className="ml-1 text-[9px] text-amber-700 font-semibold">(AI suggested — confirm)</span>}
                      </label>
                      <select value={doc.documentType || ''} onChange={e => updateCategory(doc.id, 'documentType', e.target.value)}
                        className={`w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white ${
                          aiPending ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                        }`}>
                        <option value="">— None —</option>
                        {allDocTypes.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
          </div>
        );
      })()}

      {/* Missing-fields popup — shown after a Generate-from-Template
          click when one or more {{placeholders}} resolve to empty.
          Lists them grouped by section so the user can see at a glance
          where to fill them in (e.g. "Materiality" → fill on the
          Materiality tab). User can either close + go fix the data,
          or click "Generate anyway" to bypass this gate. */}
      {missingFields && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setMissingFields(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b">
              <h4 className="text-sm font-semibold text-slate-800">Some fields are empty</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                The selected template references these fields but the engagement doesn&apos;t have values for them yet. Generating now will leave the corresponding spots blank in the output.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const grouped: Record<string, { key: string; label: string }[]> = {};
                for (const m of missingFields) {
                  if (!grouped[m.group]) grouped[m.group] = [];
                  grouped[m.group].push({ key: m.key, label: m.label });
                }
                return Object.entries(grouped).map(([group, fields]) => (
                  <div key={group}>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{group}</p>
                    <ul className="space-y-1">
                      {fields.map(f => (
                        <li key={f.key} className="text-xs text-slate-700 flex items-baseline gap-2">
                          <span className="w-1 h-1 rounded-full bg-amber-400 inline-block flex-shrink-0 mt-1.5" />
                          <span>
                            {f.label}
                            <code className="ml-1.5 text-[10px] text-slate-400">{`{{${f.key}}}`}</code>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ));
              })()}
            </div>
            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMissingFields(null)}
                className="text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
              >
                Cancel — fill in the data
              </button>
              <button
                type="button"
                onClick={() => { setMissingFields(null); void handleGenerate(true); }}
                className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700"
              >
                Generate anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="*,.zip" className="hidden" onChange={async e => {
        const file = await expandZipFile(e.target.files?.[0]);
        if (file && uploadingDocId) handleFileUpload(uploadingDocId, file);
        e.target.value = '';
      }} />

      {/* Legend */}
      <div className="mt-3 flex items-center gap-6 text-[10px] text-slate-400 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Pending</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Uploaded</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-100 text-violet-600 px-1 rounded text-[8px] inline-block">Source</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-100 text-emerald-700 px-1 rounded text-[8px] inline-block">Allocated</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-teal-100 text-teal-600 px-1 rounded text-[8px] inline-block">Location</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-100 text-amber-600 px-1 rounded text-[8px] inline-block">Type</span></span>
      </div>
    </div>
  );
}
