'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

/**
 * Audit Test Summary Results — Completion view showing:
 * - Account codes with indented drop-down showing all allocated tests from audit plan
 * - Error-raised tests and account codes coloured red/orange
 * - 3 dots per account code: Preparer, Reviewer, RI (rolled up from underlying tests)
 * - RI can sign off at this level
 */

interface TestConclusion {
  id: string;
  fsLine: string;
  testDescription: string;
  accountCode: string | null;
  conclusion: string | null; // green | orange | red | failed
  status: string; // pending | concluded | reviewed | signed_off
  totalErrors: number;
  extrapolatedError: number;
  reviewedByName: string | null;
  reviewedAt: string | null;
  riSignedByName: string | null;
  riSignedAt: string | null;
}

interface Props {
  engagementId: string;
  userRole?: string;
  userId?: string;
}

export function AuditTestSummaryPanel({ engagementId, userRole, userId }: Props) {
  const [conclusions, setConclusions] = useState<TestConclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

  const loadConclusions = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`);
      if (res.ok) {
        const data = await res.json();
        setConclusions(data.conclusions || []);
      }
    } catch {} finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadConclusions(); }, [loadConclusions]);

  // Group conclusions by account code (or fsLine if no account code)
  const grouped = new Map<string, { key: string; fsLine: string; accountCode: string; tests: TestConclusion[] }>();
  for (const c of conclusions) {
    const key = c.accountCode || c.fsLine;
    if (!grouped.has(key)) {
      grouped.set(key, { key, fsLine: c.fsLine, accountCode: c.accountCode || c.fsLine, tests: [] });
    }
    grouped.get(key)!.tests.push(c);
  }

  // Sort groups by fsLine then accountCode
  const groups = Array.from(grouped.values()).sort((a, b) => {
    if (a.fsLine !== b.fsLine) return a.fsLine.localeCompare(b.fsLine);
    return a.accountCode.localeCompare(b.accountCode);
  });

  // Rollup sign-off status for an account code
  function getRollupStatus(tests: TestConclusion[]) {
    const allConcluded = tests.every(t => t.status !== 'pending');
    const allReviewed = tests.every(t => t.reviewedByName);
    const allRISigned = tests.every(t => t.riSignedByName);
    const hasErrors = tests.some(t => t.conclusion === 'orange' || t.conclusion === 'red' || t.conclusion === 'failed');
    const worstConclusion = tests.reduce((worst, t) => {
      if (t.conclusion === 'red' || t.conclusion === 'failed') return 'red';
      if (t.conclusion === 'orange' && worst !== 'red') return 'orange';
      return worst;
    }, 'green' as string);
    return { allConcluded, allReviewed, allRISigned, hasErrors, worstConclusion };
  }

  async function handleRISignOff(conclusionId: string, isUnsign: boolean) {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conclusionId, action: isUnsign ? 'ri_unsignoff' : 'ri_signoff' }),
      });
      if (res.ok) await loadConclusions();
    } catch {}
  }

  function toggleExpand(key: string) {
    setExpandedCodes(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading test summary...</div>;

  if (groups.length === 0) {
    return <div className="p-6 text-center text-xs text-slate-400">No test conclusions recorded yet.</div>;
  }

  const CONC_COLORS: Record<string, string> = {
    green: 'bg-green-500', orange: 'bg-orange-500', red: 'bg-red-500', failed: 'bg-red-800', pending: 'bg-slate-300',
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 pb-2">
        <h3 className="text-sm font-bold text-slate-700">Audit Test Summary Results</h3>
        <div className="text-[10px] text-slate-400">{conclusions.length} test conclusion{conclusions.length !== 1 ? 's' : ''} across {groups.length} account{groups.length !== 1 ? 's' : ''}</div>
      </div>

      <div className="border rounded-lg overflow-hidden divide-y divide-slate-100">
        {groups.map(group => {
          const isExpanded = expandedCodes.has(group.key);
          const { allConcluded, allReviewed, allRISigned, hasErrors, worstConclusion } = getRollupStatus(group.tests);

          return (
            <div key={group.key}>
              {/* Account code row */}
              <button
                onClick={() => toggleExpand(group.key)}
                className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-left ${
                  hasErrors ? 'bg-red-50/30' : ''
                }`}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${CONC_COLORS[worstConclusion] || CONC_COLORS.pending}`} />
                <span className="font-mono text-[10px] text-slate-500 w-20 shrink-0">{group.accountCode}</span>
                <span className="text-xs text-slate-700 flex-1">{group.fsLine}</span>
                <span className="text-[9px] text-slate-400">{group.tests.length} test{group.tests.length !== 1 ? 's' : ''}</span>

                {/* Rolled-up sign-off dots */}
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <SignOffDotSmall label="P" signed={allConcluded} />
                  <SignOffDotSmall label="R" signed={allReviewed} />
                  <SignOffDotSmall label="RI" signed={allRISigned} />
                </div>
              </button>

              {/* Expanded: show individual tests */}
              {isExpanded && (
                <div className="bg-slate-50/50 divide-y divide-slate-100">
                  {group.tests.map(test => {
                    const testHasError = test.conclusion === 'orange' || test.conclusion === 'red' || test.conclusion === 'failed';
                    return (
                      <div key={test.id} className={`flex items-center gap-3 px-3 py-1.5 pl-10 ${testHasError ? 'bg-red-50/50' : ''}`}>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${CONC_COLORS[test.conclusion || 'pending']}`} />
                        <span className="text-[10px] text-slate-600 flex-1">{test.testDescription}</span>
                        {test.totalErrors > 0 && (
                          <span className="text-[9px] text-red-600 flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" /> {test.totalErrors} error{test.totalErrors !== 1 ? 's' : ''}
                          </span>
                        )}
                        <span className={`text-[8px] px-1 py-0 rounded ${
                          test.status === 'signed_off' ? 'bg-green-100 text-green-700' :
                          test.status === 'reviewed' ? 'bg-blue-100 text-blue-700' :
                          test.status === 'concluded' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}>{test.status}</span>

                        {/* RI sign-off button */}
                        {userRole === 'RI' && test.status !== 'pending' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRISignOff(test.id, !!test.riSignedByName); }}
                            className={`text-[8px] px-1.5 py-0.5 rounded font-medium ${
                              test.riSignedByName ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                            }`}
                          >
                            RI {test.riSignedByName ? 'Signed' : 'Sign'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignOffDotSmall({ label, signed }: { label: string; signed: boolean }) {
  return (
    <div className={`w-4 h-4 rounded-full border text-[7px] font-bold flex items-center justify-center ${
      signed ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300 text-slate-400'
    }`}>
      {signed ? '\u2713' : label}
    </div>
  );
}
