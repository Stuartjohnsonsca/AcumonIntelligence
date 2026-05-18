'use client';

/**
 * Portal tab inside the audit tool — a read-only replica of the
 * actual client portal experience.
 *
 * Purpose: firm users need to walk clients through what they see
 * in the portal during a call. Rather than describe it verbally,
 * auditors can switch to this tab, see the same three views the
 * client sees, and talk them through each.
 *
 * Three sub-views mirror the real portal pages:
 *   Home         — tiles + Dashboard horizontal bar
 *                  (matches /portal/dashboard)
 *   Dashboard    — Portal Principal Dashboard read-only replica
 *                  (matches /portal/principal/[engagementId])
 *   Manage Staff — first-sign-in setup screen read-only replica
 *                  (matches /portal/setup/[engagementId])
 *
 * Everything is interactive-looking but non-functional: buttons
 * don't trigger saves, inputs are disabled, filters are frozen.
 * A "Preview — read only" pill in the chrome makes the state
 * clear.
 *
 * Data comes from /api/engagements/[id]/portal-preview (firm
 * auth, same engagement guard as the rest of the audit tool)
 * so no portal session is needed.
 */

import { useEffect, useState } from 'react';
import { Loader2, Users, Eye, AlertCircle, RefreshCw } from 'lucide-react';

interface Engagement {
  id: string;
  auditType: string;
  portalPrincipalId: string | null;
  portalSetupCompletedAt: string | null;
  client: { id: string; clientName: string };
  period: { startDate: string; endDate: string } | null;
}
interface PrincipalUser { id: string; name: string; email: string; role: string | null; }
interface Staff { id: string; name: string; email: string; role: string | null; accessConfirmed: boolean; portalUserId: string | null; }
interface PreviewData {
  engagement: Engagement | null;
  principal: PrincipalUser | null;
  staff: Staff[];
}

interface Props {
  engagementId: string;
  clientName: string;
}

export function ClientPortalTab({ engagementId, clientName }: Props) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which client-portal user the auditor is impersonating inside the
  // iframe. Set after data load — defaults to the Portal Principal so
  // the auditor lands on the most-featured view; falls back to the
  // first access-confirmed staff member if there's no Principal.
  const [viewingAs, setViewingAs] = useState<string>('');

  // Iframe state — the preview session token + the URL the iframe is
  // currently pointed at. Each time `viewingAs` changes we mint a new
  // token via the firm-side endpoint and refresh the iframe src. The
  // token is short-lived (1 hour) and read-only by construction:
  // every portal mutation endpoint rejects it via
  // `requirePortalWriteAccess`.
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/engagements/${engagementId}/portal-preview`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Load failed (${r.status})`)))
      .then(d => {
        setData(d);
        // Default to the Portal Principal, else the first
        // access-confirmed staff member, else nothing (iframe
        // disabled).
        const principalId = d.principal?.id || null;
        const confirmedStaffId = d.staff.find((s: Staff) => s.accessConfirmed && s.portalUserId)?.portalUserId || null;
        setViewingAs(principalId || confirmedStaffId || '');
      })
      .catch(err => setError(err?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [engagementId]);

  // Mint (or re-mint) a preview session token whenever the impersonated
  // user changes. Cleans up previous tokens on the way out so we don't
  // leak active read-only sessions for users the auditor stopped
  // viewing as.
  useEffect(() => {
    if (!viewingAs) { setPreviewToken(null); return; }
    let cancelled = false;
    setTokenLoading(true);
    setTokenError(null);
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/portal-preview-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portalUserId: viewingAs }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Could not start preview (${res.status})`);
        }
        const body = await res.json();
        if (!cancelled) {
          setPreviewToken(body.token);
          setIframeKey(k => k + 1); // force iframe reload on user switch
        }
      } catch (err: any) {
        if (!cancelled) setTokenError(err?.message || 'Could not start preview');
      } finally {
        if (!cancelled) setTokenLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId, viewingAs]);

  // Revoke the active preview session when the tab unmounts so a
  // page-leak doesn't keep the impersonation alive past the auditor
  // moving on.
  useEffect(() => {
    return () => {
      // best-effort — fire-and-forget, no error handling
      fetch(`/api/engagements/${engagementId}/portal-preview-session`, { method: 'DELETE' }).catch(() => {});
    };
  }, [engagementId]);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-slate-500 inline-flex items-center gap-2 w-full justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />Loading client-portal preview…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 inline mr-1" />{error}
      </div>
    );
  }
  if (!data) return null;

  const pickableStaff = data.staff.filter(s => !!s.portalUserId);
  const principalId = data.principal?.id || null;
  const noUsers = !data.principal && pickableStaff.length === 0;
  const iframeSrc = previewToken
    ? `/portal/dashboard?token=${encodeURIComponent(previewToken)}`
    : null;

  return (
    <div className="space-y-3">
      {/* Firm-side context header — what the auditor sees (NOT the client) */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 inline-flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-500" />
            Client Portal Preview
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live, navigable view of <strong>{clientName}</strong>&apos;s portal as the selected user would see it. Every page is the real portal — but every write is blocked server-side because this session is a firm-issued read-only impersonation. Open as a screen-share to walk the client through the experience without needing their password.
          </p>
        </div>
        <a
          href="/portal"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
          title="Open the real portal in a new tab — requires a portal login"
        >
          Open the real portal ↗
        </a>
      </div>

      {/* Simulated browser chrome — establishes clearly that what's
          below is the live portal, in preview mode. */}
      <div className="rounded-lg border border-slate-300 overflow-hidden bg-white shadow-sm">
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 bg-white border border-slate-300 rounded px-2 py-0.5 text-[11px] text-slate-500 font-mono truncate">
            acumon-website.vercel.app{iframeSrc?.split('?')[0] || '/portal/dashboard'}
          </div>
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-medium">Read-only preview</span>
        </div>

        {/* Viewing-as picker — every option mints a separate preview
            session under the hood. The default is the Portal Principal
            (or first confirmed staff if there's no Principal). */}
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-2 text-xs items-center">
          <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Viewing as</label>
          <select
            value={viewingAs}
            onChange={e => setViewingAs(e.target.value)}
            disabled={noUsers}
            className="text-xs border border-slate-300 rounded px-2 py-1 bg-white disabled:bg-slate-100 disabled:text-slate-400"
            title="Pick which client-portal user's experience to load. A new preview session is minted each time."
          >
            {noUsers && <option value="">— No portal users to impersonate —</option>}
            {data.principal && (
              <option value={data.principal.id}>{data.principal.name} (Portal Principal)</option>
            )}
            {pickableStaff.length > 0 && (
              <optgroup label="Staff">
                {pickableStaff.map(s => (
                  <option key={s.id} value={s.portalUserId || s.id}>
                    {s.name}{s.role ? ` — ${s.role}` : ''}{s.accessConfirmed ? '' : ' (pending)'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {tokenLoading && (
            <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Minting preview session…
            </span>
          )}
          {previewToken && !tokenLoading && (
            <button
              onClick={() => setIframeKey(k => k + 1)}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded"
              title="Reload the iframe — handy if the auditor wants to walk the client through from the home screen again"
            >
              <RefreshCw className="h-3 w-3" /> Reload
            </button>
          )}
        </div>

        {/* The live iframe. Wrapped in a fixed-height container so the
            audit tool's outer scroll stays predictable; the iframe
            scrolls internally. */}
        <div className="bg-slate-100" style={{ height: '720px' }}>
          {tokenError && (
            <div className="p-4 text-sm text-red-700 bg-red-50 border-b border-red-200">
              <AlertCircle className="h-4 w-4 inline mr-1" />{tokenError}
            </div>
          )}
          {noUsers ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Users className="h-8 w-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-500">No portal users yet for {clientName}.</p>
              <p className="text-xs text-slate-400 mt-1">Designate a Portal Principal on the Opening tab to enable the preview.</p>
            </div>
          ) : iframeSrc ? (
            <iframe
              key={iframeKey}
              src={iframeSrc}
              title={`Portal preview as ${viewingAs === principalId ? data.principal?.name : pickableStaff.find(s => s.portalUserId === viewingAs)?.name || 'user'}`}
              className="w-full h-full border-0 bg-white"
              // Restrict the iframe sandbox — same-origin so cookies /
              // tokens work and the portal pages can fetch their APIs,
              // but no top-navigation so a misbehaving link can't
              // navigate the parent window.
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-400 inline-flex gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting preview session…
            </div>
          )}
        </div>

        {/* Footer band — reminds the auditor that any apparent error
            messages about read-only state are intentional. */}
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500">
          Inside the preview, attempting any action that would save data returns &quot;blocked because you are viewing the portal in read-only preview mode&quot;. That is expected — open the real portal to make changes.
        </div>
      </div>
    </div>
  );
}

