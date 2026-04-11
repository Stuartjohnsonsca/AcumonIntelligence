'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck, Loader2, CheckCircle2, Plus, MessageSquare } from 'lucide-react';

type TeamMember = { userId: string; userName?: string; role: string };

interface Props {
  engagementId: string;
  userId?: string;
  userName?: string;
  teamMembers?: TeamMember[];
}

interface EngagementSummary {
  teamCount: number;
  eqrName: string | null;
  sigRiskCount: number;
  aofCount: number;
  overallMateriality: number | null;
  performanceMateriality: number | null;
  clearlyTrivial: number | null;
  completionSignOffProgress: { total: number; signed: number };
}

interface ReviewPoint {
  id: string;
  chatNumber: number;
  description: string;
  status: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  responses?: any[];
}

export function EQRReviewPanel({ engagementId, userId, userName, teamMembers }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [points, setPoints] = useState<ReviewPoint[]>([]);
  const [approval, setApproval] = useState<{ userId: string; userName: string; timestamp: string } | null>(null);
  const [newPointText, setNewPointText] = useState('');
  const [creatingPoint, setCreatingPoint] = useState(false);
  const [togglingApproval, setTogglingApproval] = useState(false);

  const currentUserIsEQR = !!userId && !!teamMembers?.some(m => m.role === 'EQR' && m.userId === userId);

  useEffect(() => { loadAll(); }, [engagementId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [matRes, rmmRes, pointsRes, apprRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/materiality`),
        fetch(`/api/engagements/${engagementId}/rmm`),
        fetch(`/api/engagements/${engagementId}/audit-points?type=review_point`),
        fetch(`/api/engagements/${engagementId}/permanent-file?section=eqr_approval`),
      ]);

      const matData = matRes.ok ? await matRes.json() : {};
      const rmmData = rmmRes.ok ? await rmmRes.json() : {};
      const pointsData = pointsRes.ok ? await pointsRes.json() : {};
      const apprData = apprRes.ok ? await apprRes.json() : {};

      const mat = matData.materiality?.data || matData.data || {};
      const rmmRows = rmmData.rows || [];
      const sigRiskCount = rmmRows.filter((r: any) => r.overallRisk === 'High' || r.overallRisk === 'Very High').length;
      const aofCount = rmmRows.filter((r: any) => r.overallRisk === 'Medium').length;

      setSummary({
        teamCount: teamMembers?.length || 0,
        eqrName: teamMembers?.find(m => m.role === 'EQR')?.userName || null,
        sigRiskCount,
        aofCount,
        overallMateriality: mat.overallMateriality || mat.materiality || null,
        performanceMateriality: mat.performanceMateriality || mat.pm || null,
        clearlyTrivial: mat.clearlyTrivial || mat.ct || null,
        completionSignOffProgress: { total: 0, signed: 0 },
      });
      setPoints(pointsData.points || []);

      const apprRecord = apprData.answers?.eqr_approval || apprData.data?.eqr_approval;
      setApproval(apprRecord?.approval || null);
    } finally {
      setLoading(false);
    }
  }

  async function createReviewPoint() {
    if (!newPointText.trim() || !currentUserIsEQR) return;
    setCreatingPoint(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointType: 'review_point', description: newPointText.trim(), reference: 'EQR Review' }),
      });
      if (res.ok) {
        setNewPointText('');
        await loadAll();
      }
    } finally {
      setCreatingPoint(false);
    }
  }

  async function closePoint(id: string) {
    await fetch(`/api/engagements/${engagementId}/audit-points`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'close' }),
    });
    await loadAll();
  }

  async function toggleApproval() {
    if (!currentUserIsEQR || !userId) return;
    setTogglingApproval(true);
    try {
      const newApproval = approval
        ? null
        : { userId, userName: userName || 'EQR', timestamp: new Date().toISOString() };
      await fetch(`/api/engagements/${engagementId}/permanent-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_data',
          section: 'eqr_approval',
          data: { eqr_approval: { approval: newApproval } },
        }),
      });
      setApproval(newApproval);
    } finally {
      setTogglingApproval(false);
    }
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading EQR review...</div>;
  if (!summary) return <div className="p-6 text-center text-xs text-slate-400">Failed to load engagement summary</div>;

  const openPoints = points.filter(p => p.status === 'open');
  const closedPoints = points.filter(p => p.status !== 'open');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-purple-600" />
        <h3 className="text-sm font-bold text-slate-700">EQR Review</h3>
        {!currentUserIsEQR && (
          <span className="text-[10px] text-slate-400 ml-auto">Read-only — only the assigned EQR can interact with this tab</span>
        )}
      </div>

      {/* ── Master approval ── */}
      <div className={`border-2 rounded-lg p-4 ${approval ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-slate-50'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              {approval ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <ShieldCheck className="h-5 w-5 text-slate-400" />}
              <h4 className="text-sm font-semibold text-slate-800">EQR Approval</h4>
            </div>
            {approval ? (
              <p className="text-[11px] text-slate-600 mt-1">
                Approved by <span className="font-medium">{approval.userName}</span> on {new Date(approval.timestamp).toLocaleString('en-GB')}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-1">Engagement has not yet received EQR approval.</p>
            )}
          </div>
          <button
            onClick={toggleApproval}
            disabled={!currentUserIsEQR || togglingApproval}
            className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${
              approval
                ? 'bg-white border border-green-300 text-green-700 hover:bg-green-50'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={currentUserIsEQR ? '' : 'Only the EQR can toggle approval'}
          >
            {togglingApproval ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
            {approval ? 'Withdraw Approval' : 'Approve Engagement'}
          </button>
        </div>
      </div>

      {/* ── Engagement summary ── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-blue-50 px-3 py-2 border-b border-blue-100">
          <h4 className="text-xs font-bold text-blue-800 uppercase">Engagement Summary</h4>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 text-xs">
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Team</div>
            <div className="text-slate-700 mt-0.5">{summary.teamCount} member{summary.teamCount === 1 ? '' : 's'}</div>
            {summary.eqrName && <div className="text-[10px] text-slate-500">EQR: {summary.eqrName}</div>}
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Significant Risks</div>
            <div className="text-slate-700 mt-0.5">{summary.sigRiskCount} sig risk{summary.sigRiskCount === 1 ? '' : 's'}, {summary.aofCount} area{summary.aofCount === 1 ? '' : 's'} of focus</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Overall Materiality</div>
            <div className="text-slate-700 mt-0.5">{summary.overallMateriality ? `£${Number(summary.overallMateriality).toLocaleString('en-GB')}` : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Performance Materiality</div>
            <div className="text-slate-700 mt-0.5">{summary.performanceMateriality ? `£${Number(summary.performanceMateriality).toLocaleString('en-GB')}` : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Clearly Trivial</div>
            <div className="text-slate-700 mt-0.5">{summary.clearlyTrivial ? `£${Number(summary.clearlyTrivial).toLocaleString('en-GB')}` : '—'}</div>
          </div>
        </div>
      </div>

      {/* ── Review points (EQR-managed) ── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-blue-50 px-3 py-2 border-b border-blue-100 flex items-center justify-between">
          <h4 className="text-xs font-bold text-blue-800 uppercase">Review Points</h4>
          <span className="text-[10px] text-blue-700">{openPoints.length} open · {closedPoints.length} closed</span>
        </div>

        {currentUserIsEQR && (
          <div className="p-3 border-b bg-slate-50/50 space-y-2">
            <textarea
              value={newPointText}
              onChange={(e) => setNewPointText(e.target.value)}
              placeholder="Raise a new review point…"
              rows={2}
              className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-purple-400"
            />
            <button
              onClick={createReviewPoint}
              disabled={creatingPoint || !newPointText.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
            >
              {creatingPoint ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Raise Point
            </button>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {points.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">
              <MessageSquare className="h-6 w-6 mx-auto text-slate-300 mb-2" />
              No review points raised yet.
            </div>
          )}
          {points.map(p => (
            <div key={p.id} className={`p-3 ${p.status === 'open' ? 'bg-white' : 'bg-slate-50/40'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500">#{p.chatNumber}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${
                      p.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'
                    }`}>{p.status}</span>
                    <span className="text-[10px] text-slate-400">raised by {p.createdByName}</span>
                  </div>
                  <p className="text-xs text-slate-700 mt-1">{p.description}</p>
                  {Array.isArray(p.responses) && p.responses.length > 0 && (
                    <div className="mt-2 space-y-1 pl-3 border-l-2 border-slate-200">
                      {p.responses.map((r: any, i: number) => (
                        <div key={i} className="text-[10px] text-slate-600">
                          <span className="font-medium">{r.userName}:</span> {r.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {p.status === 'open' && currentUserIsEQR && (
                  <button
                    onClick={() => closePoint(p.id)}
                    className="text-[10px] text-green-600 hover:text-green-700 whitespace-nowrap"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
