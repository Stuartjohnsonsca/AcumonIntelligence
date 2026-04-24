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

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, BarChart3, Users, ArrowRight, ClipboardCheck, Calculator,
  Briefcase, Receipt, Monitor, Eye, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Clock, Filter, RefreshCw, Settings,
  AlertTriangle,
} from 'lucide-react';

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
interface Allocation { id: string; fsLineId: string | null; tbAccountCode: string | null; staff1UserId: string | null; staff2UserId: string | null; staff3UserId: string | null; }
interface FsGroup { fsLineId: string | null; fsLineName: string; tbRows: Array<{ accountCode: string; description: string }>; }
interface PortalReq {
  id: string;
  section: string;
  question: string;
  status: string;
  requestedAt: string;
  respondedAt?: string | null;
  respondedByName?: string | null;
  routingFsLineId: string | null;
  routingTbAccountCode: string | null;
  assignedPortalUserId: string | null;
  escalationLevel: number;
}
interface PreviewData {
  engagement: Engagement | null;
  principal: PrincipalUser | null;
  staff: Staff[];
  allocations: Allocation[];
  fsLineGroups: FsGroup[];
  requests: PortalReq[];
  escalationDays: { days1: number; days2: number; days3: number; source: string };
}

interface Props {
  engagementId: string;
  clientName: string;
}

type View = 'home' | 'dashboard' | 'manage';

const HOME_TILES = [
  { title: 'Audit Client Support', description: 'View and respond to audit evidence requests, upload documents, and track progress.',              icon: ClipboardCheck, color: 'bg-blue-50 border-blue-200',     iconBg: 'bg-blue-100',     iconColor: 'text-blue-600' },
  { title: 'Accounting Support',   description: 'Get help with bookkeeping, financial reporting, and accounting queries.',                           icon: Calculator,     color: 'bg-teal-50 border-teal-200',     iconBg: 'bg-teal-100',     iconColor: 'text-teal-600' },
  { title: 'Consulting Support',   description: 'Business advisory, strategy, and operational improvement assistance.',                               icon: Briefcase,      color: 'bg-purple-50 border-purple-200', iconBg: 'bg-purple-100',   iconColor: 'text-purple-600' },
  { title: 'Tax Support',          description: 'Tax planning, compliance, VAT queries, and tax return assistance.',                                  icon: Receipt,        color: 'bg-amber-50 border-amber-200',   iconBg: 'bg-amber-100',    iconColor: 'text-amber-600' },
  { title: 'Technology Support',   description: 'IT systems, software, digital transformation, and tech infrastructure help.',                        icon: Monitor,        color: 'bg-indigo-50 border-indigo-200', iconBg: 'bg-indigo-100',   iconColor: 'text-indigo-600' },
];

function formatPeriod(p: { startDate: string; endDate: string } | null): string {
  if (!p) return '';
  const f = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${f(p.startDate)} – ${f(p.endDate)}`;
}

export function ClientPortalTab({ engagementId, clientName }: Props) {
  const [view, setView] = useState<View>('home');
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/engagements/${engagementId}/portal-preview`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Load failed (${r.status})`)))
      .then(d => setData(d))
      .catch(err => setError(err?.message || 'Load failed'))
      .finally(() => setLoading(false));
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

  return (
    <div className="space-y-3">
      {/* Firm-side context header — what the auditor sees (NOT the client) */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 inline-flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-500" />
            Client Portal Preview
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Read-only replica of what <strong>{clientName}</strong> sees in their portal. Walk the client through each view without needing their login.
          </p>
        </div>
      </div>

      {/* Simulated browser chrome — establishes clearly that what's
          below is a REPLICA, not the audit tool. */}
      <div className="rounded-lg border border-slate-300 overflow-hidden bg-white shadow-sm">
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 bg-white border border-slate-300 rounded px-2 py-0.5 text-[11px] text-slate-500 font-mono truncate">
            acumon-website.vercel.app
            {view === 'home'      && '/portal/dashboard'}
            {view === 'dashboard' && `/portal/principal/${engagementId}`}
            {view === 'manage'    && `/portal/setup/${engagementId}`}
          </div>
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-medium">Preview — read only</span>
        </div>

        {/* View switcher — mimics nothing in the real portal, it's just
             a convenience for the auditor walking through each screen. */}
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex gap-1 text-xs">
          <button
            onClick={() => setView('home')}
            className={`px-2.5 py-1 rounded ${view === 'home' ? 'bg-white border border-slate-300 text-slate-800 font-medium' : 'text-slate-600 hover:bg-white'}`}
          >Home</button>
          <button
            onClick={() => setView('dashboard')}
            className={`px-2.5 py-1 rounded ${view === 'dashboard' ? 'bg-white border border-slate-300 text-slate-800 font-medium' : 'text-slate-600 hover:bg-white'}`}
          >Principal Dashboard</button>
          <button
            onClick={() => setView('manage')}
            className={`px-2.5 py-1 rounded ${view === 'manage' ? 'bg-white border border-slate-300 text-slate-800 font-medium' : 'text-slate-600 hover:bg-white'}`}
          >Manage Staff</button>
        </div>

        {/* The replica itself. pointer-events-none on the outer frame
             makes every visible control inert; visible styles kept
             so the client sees exactly what they'll see. */}
        <div className="p-6 bg-slate-50 pointer-events-none select-text">
          {view === 'home'      && <HomeView data={data} />}
          {view === 'dashboard' && <DashboardView data={data} />}
          {view === 'manage'    && <ManageView data={data} />}
        </div>
      </div>
    </div>
  );
}

// ─── Home view replica ────────────────────────────────────────────

function HomeView({ data }: { data: PreviewData }) {
  const setupComplete = !!data.engagement?.portalSetupCompletedAt;
  const hasPrincipal = !!data.principal;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Welcome to your Client Portal</h1>
        <p className="text-sm text-slate-500 mt-1">Access your services and — if you&apos;re a Portal Principal — manage your staff and review engagement activity.</p>
      </div>

      {/* Outstanding-setup banner (only when relevant) */}
      {hasPrincipal && !setupComplete && (
        <div className="mb-4 bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Portal Principal setup outstanding</p>
              <p className="text-xs text-amber-700 mt-0.5">
                You are the Portal Principal for this engagement. Staff members cannot log in until you complete setup.
              </p>
              <div className="mt-3">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-white bg-amber-600 px-3 py-1.5 rounded-md">
                  Finish setup — {data.engagement?.client.clientName}
                  <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Horizontal Dashboard bar (if Principal + setup complete) */}
      {hasPrincipal && setupComplete && (
        <div className="mb-5">
          <div className="block bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="bg-emerald-100 rounded-xl p-3 flex-shrink-0">
                <BarChart3 className="h-6 w-6 text-emerald-700" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900">Portal Principal Dashboard</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Review requests, responses and staff performance for {data.engagement?.client.clientName}.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            </div>
          </div>
        </div>
      )}

      {/* 3×2 service-tile grid — 5 services + Manage Staff (if Principal) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {HOME_TILES.map(t => (
          <div key={t.title} className={`block p-7 rounded-xl border-2 shadow-sm ${t.color}`}>
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${t.iconBg} mb-3`}>
              <t.icon className={`h-6 w-6 ${t.iconColor}`} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">{t.title}</h2>
            <p className="text-sm text-slate-600">{t.description}</p>
          </div>
        ))}
        {hasPrincipal && setupComplete && (
          <div className="block p-7 rounded-xl border-2 shadow-sm bg-rose-50 border-rose-200">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-rose-100 mb-3">
              <Users className="h-6 w-6 text-rose-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Manage Staff</h2>
            <p className="text-sm text-slate-600">Curate who can access the portal, confirm each staff member, and map them to FS Lines / TB codes.</p>
          </div>
        )}
      </div>

      {!hasPrincipal && (
        <div className="mt-4 text-xs text-slate-500 bg-white border border-dashed border-slate-300 rounded p-3 text-center">
          No Portal Principal designated for this engagement yet — the Dashboard bar and Manage Staff tile won&apos;t appear for this client until one is nominated on the Opening tab.
        </div>
      )}
    </div>
  );
}

// ─── Principal Dashboard view replica ─────────────────────────────

function DashboardView({ data }: { data: PreviewData }) {
  const sla = data.escalationDays;
  const now = new Date();
  const requests = data.requests;
  const outstanding = requests.filter(r => r.status === 'outstanding');
  const responded = requests.filter(r => r.status === 'responded' || !!r.respondedAt);
  const escalated = outstanding.filter(r => (r.escalationLevel ?? 0) > 0);
  const overdue = outstanding.filter(r => {
    // Simplified overdue calc — uses the assigned-at proxy of
    // requestedAt since we don't pull assignedAt in the preview.
    const hours = (now.getTime() - new Date(r.requestedAt).getTime()) / 3_600_000;
    const cs = r.escalationLevel === 0 ? sla.days1 : r.escalationLevel === 1 ? sla.days2 : sla.days3;
    return hours > cs * 24;
  });

  const staffName = new Map(data.staff.map(s => [s.portalUserId, s.name]));
  const fsName = new Map(data.fsLineGroups.map(g => [g.fsLineId, g.fsLineName]));
  if (data.principal) staffName.set(data.principal.id, `${data.principal.name} (Principal)`);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between bg-white border border-slate-200 rounded-lg p-5">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Portal Principal Dashboard</p>
          <h1 className="text-xl font-semibold text-slate-800 mt-0.5">{data.engagement?.client.clientName}</h1>
          <p className="text-xs text-slate-500 mt-1">
            SLA: <strong className="text-slate-700">{sla.days1}</strong> / <strong className="text-slate-700">{sla.days2}</strong> / <strong className="text-slate-700">{sla.days3}</strong> days
            <span className="ml-2 text-slate-400">({sla.source.replace('-', ' ')})</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 bg-white"><Settings className="w-4 h-4" />Setup</span>
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm"><RefreshCw className="w-4 h-4" />Refresh</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Outstanding"              value={outstanding.length} icon={<Clock className="w-4 h-4" />} tone="blue" />
        <Kpi label="Overdue (SLA breached)"   value={overdue.length}     icon={<AlertTriangle className="w-4 h-4" />} tone={overdue.length > 0 ? 'amber' : 'slate'} />
        <Kpi label="Escalated"                value={escalated.length}   icon={<ArrowRight className="w-4 h-4" />}    tone={escalated.length > 0 ? 'red' : 'slate'} />
        <Kpi label="Responded"                value={responded.length}   icon={<CheckCircle2 className="w-4 h-4" />}  tone="emerald" />
      </div>

      {/* Filter bar placeholder — replica only, non-functional. */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Search requests</span>
          <span className="text-[11px] text-slate-400">— ask in plain English: &quot;overdue from Alice&quot;, &quot;bank statements outstanding&quot;, etc.</span>
        </div>
        <div className="flex gap-2">
          <input placeholder="What are you looking for?" disabled className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-slate-50" />
          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white"><Filter className="w-4 h-4" />Search</span>
        </div>
      </div>

      {/* Request list */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-200">
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium">Question</th>
              <th className="text-left font-medium">FS Line / TB</th>
              <th className="text-left font-medium">Assignee</th>
              <th className="text-right font-medium pr-4">Age</th>
            </tr>
          </thead>
          <tbody>
            {requests.slice(0, 20).map(r => {
              const assignee = r.assignedPortalUserId ? staffName.get(r.assignedPortalUserId) : null;
              const fs = r.routingFsLineId ? fsName.get(r.routingFsLineId) : null;
              const ageHours = (now.getTime() - new Date(r.requestedAt).getTime()) / 3_600_000;
              const age = ageHours < 1 ? '< 1h' : ageHours < 24 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`;
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2">
                    {r.respondedAt ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-emerald-50 border-emerald-200 text-emerald-700">Responded</span>
                    ) : r.escalationLevel >= 3 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-red-50 border-red-200 text-red-700">Escalated to you</span>
                    ) : r.escalationLevel > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-amber-50 border-amber-200 text-amber-700">Escalated · col {r.escalationLevel + 1}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-slate-50 border-slate-200 text-slate-700">Outstanding</span>
                    )}
                  </td>
                  <td className="text-slate-700 max-w-md truncate" title={r.question}>{r.question || '(no question text)'}</td>
                  <td className="text-slate-600">
                    {fs ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
                        {fs}{r.routingTbAccountCode ? ` · ${r.routingTbAccountCode}` : ''}
                      </span>
                    ) : <span className="text-[11px] text-slate-400">—</span>}
                  </td>
                  <td className="text-slate-600 text-xs">{assignee || <span className="text-slate-400">unassigned</span>}</td>
                  <td className="text-right text-xs text-slate-500 pr-4 whitespace-nowrap">{age}</td>
                </tr>
              );
            })}
            {requests.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500 italic">No requests on this engagement yet.</td></tr>
            )}
          </tbody>
        </table>
        {requests.length > 20 && (
          <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-500">Showing first 20 of {requests.length} — the real dashboard paginates.</div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'blue' | 'amber' | 'red' | 'emerald' | 'slate' }) {
  const tc =
    tone === 'blue'    ? 'bg-blue-50 border-blue-200 text-blue-800'    :
    tone === 'amber'   ? 'bg-amber-50 border-amber-200 text-amber-800' :
    tone === 'red'     ? 'bg-red-50 border-red-200 text-red-800'       :
    tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
    'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className={`border rounded-lg p-4 ${tc}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide">{icon}{label}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );
}

// ─── Manage Staff (setup screen) view replica ─────────────────────

function ManageView({ data }: { data: PreviewData }) {
  const [openStaff, setOpenStaff] = useState(true);
  const [openAlloc, setOpenAlloc] = useState(true);
  const [expandedFs, setExpandedFs] = useState<Set<string>>(new Set());
  const eng = data.engagement;
  const setupComplete = !!eng?.portalSetupCompletedAt;
  const approvedStaff = data.staff.filter(s => s.accessConfirmed);
  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data.staff) if (s.portalUserId) m.set(s.portalUserId, s.name);
    if (data.principal) m.set(data.principal.id, `${data.principal.name} (Principal)`);
    return m;
  }, [data.staff, data.principal]);

  function allocFor(fsLineId: string | null, tbAccountCode: string | null): Allocation | null {
    return data.allocations.find(a => a.fsLineId === fsLineId && a.tbAccountCode === tbAccountCode) || null;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Portal Principal Setup</p>
            <h1 className="text-xl font-semibold text-slate-800 mt-0.5">{eng?.client.clientName}</h1>
            <p className="text-sm text-slate-600 mt-0.5">{formatPeriod(eng?.period ?? null)} · {eng?.auditType}</p>
          </div>
          {setupComplete ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" />Setup complete
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm">
              <CheckCircle2 className="w-4 h-4" />Complete setup
            </span>
          )}
        </div>
        {!setupComplete && (
          <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded p-2">
            While setup is outstanding, <strong>no staff member can log in</strong>.
          </p>
        )}
      </div>

      {/* Staff section */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <button onClick={() => setOpenStaff(!openStaff)} className="w-full flex items-center justify-between px-5 py-4 text-left pointer-events-auto">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Staff</h2>
            <p className="text-xs text-slate-500 mt-0.5">{data.staff.length} on list · {approvedStaff.length} approved</p>
          </div>
          {openStaff ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        </button>
        {openStaff && (
          <div className="border-t border-slate-200 p-5 space-y-4">
            {data.staff.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No staff added yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200">
                    <th className="text-left font-medium py-2">Name</th>
                    <th className="text-left font-medium">Email</th>
                    <th className="text-left font-medium">Role</th>
                    <th className="text-center font-medium">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map(s => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 text-slate-800">{s.name}</td>
                      <td className="text-slate-600">{s.email}</td>
                      <td className="text-slate-500">{s.role || '—'}</td>
                      <td className="text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border ${s.accessConfirmed ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                          {s.accessConfirmed ? <><CheckCircle2 className="w-3 h-3" />Confirmed</> : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Work allocation section */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <button onClick={() => setOpenAlloc(!openAlloc)} className="w-full flex items-center justify-between px-5 py-4 text-left pointer-events-auto">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Work Allocation</h2>
            <p className="text-xs text-slate-500 mt-0.5">{data.fsLineGroups.length} FS Lines — up to 3 staff per line / TB code</p>
          </div>
          {openAlloc ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        </button>
        {openAlloc && (
          <div className="border-t border-slate-200">
            <div className="grid grid-cols-[minmax(200px,3fr)_1fr_1fr_1fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <div className="font-medium">FS Line / TB code</div>
              {[1, 2, 3].map(col => (
                <div key={col} className="text-center">
                  <div className="font-medium text-slate-700">Column {col}</div>
                  <div className="text-[11px]">{(data.escalationDays as any)[`days${col}`]} day{(data.escalationDays as any)[`days${col}`] === 1 ? '' : 's'} to escalate</div>
                </div>
              ))}
            </div>
            <div className="divide-y divide-slate-100">
              {data.fsLineGroups.map(g => {
                const key = g.fsLineId ?? g.fsLineName;
                const isExp = expandedFs.has(key);
                const alloc = allocFor(g.fsLineId, null);
                return (
                  <div key={key}>
                    <div className="grid grid-cols-[minmax(200px,3fr)_1fr_1fr_1fr] gap-3 px-5 py-2 items-center">
                      <button
                        onClick={() => {
                          setExpandedFs(prev => {
                            const n = new Set(prev);
                            if (n.has(key)) n.delete(key); else n.add(key);
                            return n;
                          });
                        }}
                        className="flex w-full items-center justify-start gap-1.5 text-left text-sm font-medium text-slate-800 pointer-events-auto"
                      >
                        {isExp ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                        <span className="truncate">{g.fsLineName}</span>
                        <span className="text-[11px] text-slate-400 flex-shrink-0">({g.tbRows.length} TB)</span>
                      </button>
                      {([1, 2, 3] as const).map(col => {
                        const k = `staff${col}UserId` as 'staff1UserId' | 'staff2UserId' | 'staff3UserId';
                        const uid = (alloc?.[k] as string | null) ?? null;
                        const name = uid ? staffById.get(uid) : null;
                        return (
                          <div key={col} className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-600 truncate">
                            {name || <span className="text-slate-400">— unassigned —</span>}
                          </div>
                        );
                      })}
                    </div>
                    {isExp && g.tbRows.map(tb => {
                      const tbAlloc = allocFor(g.fsLineId, tb.accountCode);
                      return (
                        <div key={tb.accountCode} className="grid grid-cols-[minmax(200px,3fr)_1fr_1fr_1fr] gap-3 px-5 py-2 items-center">
                          <div className="pl-6 text-xs text-slate-700">
                            <span className="font-mono text-slate-500 mr-2">{tb.accountCode}</span>
                            {tb.description}
                          </div>
                          {([1, 2, 3] as const).map(col => {
                            const k = `staff${col}UserId` as 'staff1UserId' | 'staff2UserId' | 'staff3UserId';
                            const uid = (tbAlloc?.[k] as string | null) ?? null;
                            const name = uid ? staffById.get(uid) : null;
                            return (
                              <div key={col} className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-600 truncate">
                                {name || <span className="text-slate-400">— unassigned —</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {data.fsLineGroups.length === 0 && (
                <div className="px-5 py-6 text-xs text-slate-500 italic">
                  No FS Lines on this engagement yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
