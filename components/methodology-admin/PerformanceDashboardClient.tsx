'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSearch,
  Flame,
  GraduationCap,
  Heart,
  LineChart,
  Loader2,
  Megaphone,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Server-shape types                                                  */
/* ------------------------------------------------------------------ */

type MonitoringActivity = {
  id: string;
  activityType: string;
  engagementName: string | null;
  responsibleIndividualName: string | null;
  managerName: string | null;
  reviewerName: string | null;
  plannedDate: string | null;
  startedDate: string | null;
  completedDate: string | null;
  status: string;
  outcomeRating: string | null;
  qualityScore: number | null;
  findingsCount: number;
  notes: string | null;
};

type Finding = {
  id: string;
  activityId: string | null;
  title: string;
  description: string | null;
  rootCauseCategory: string | null;
  severity: string;
  raisedDate: string;
  rcaCompletedDate: string | null;
  closedDate: string | null;
  status: string;
};

type Remediation = {
  id: string;
  findingId: string;
  description: string;
  ownerName: string | null;
  dueDate: string | null;
  status: string;
  retestedDate: string | null;
  effective: boolean | null;
};

type Csf = {
  id: string;
  pillar: string;
  subComponent: string;
  name: string;
  targetMetric: string | null;
  currentMetric: string | null;
  rag: string;
  ownerName: string | null;
  reviewedDate: string | null;
  isActive: boolean;
};

type PeopleSnapshot = {
  id: string;
  periodLabel: string;
  periodEnd: string;
  trainingEffectivenessPct: number | null;
  staffUtilisationPct: number | null;
  cultureSurveyScore: number | null;
  attritionPct: number | null;
};

type ScheduleItem = {
  id: string;
  year: number;
  monthIndex: number;
  activityName: string;
  status: string;
  ownerName: string | null;
  dueDate: string | null;
  completedDate: string | null;
};

type IsqmEvidence = {
  id: string;
  objective: string;
  evidenceCount: number;
  targetCount: number;
  rag: string;
  ragManual: boolean;
  notes: string | null;
};

type PillarScore = {
  id: string;
  pillar: string;
  manualScore: number | null;
  strapline: string | null;
};

type AiTool = {
  id: string;
  name: string;
  vendor: string | null;
  modelVersion: string | null;
  auditArea: string | null;
  riskRating: string;
  ownerName: string | null;
  validationStatus: string;
  lastValidatedDate: string | null;
  nextValidationDue: string | null;
  approvedForUse: boolean;
  humanInLoop: boolean;
  isActive: boolean;
};

type AiUsage = {
  id: string;
  toolId: string;
  usedDate: string;
  reviewerName: string | null;
  outputDecision: string;
  materiality: string;
};

type AiValidation = {
  id: string;
  toolId: string;
  testDate: string;
  testType: string;
  result: string;
  accuracyPct: number | null;
};

type Summary = {
  monitoringActivities: MonitoringActivity[];
  findings: Finding[];
  remediations: Remediation[];
  csfs: Csf[];
  peopleSnapshots: PeopleSnapshot[];
  activitySchedule: ScheduleItem[];
  isqmEvidence: IsqmEvidence[];
  pillarScores: PillarScore[];
  aiTools: AiTool[];
  aiUsage: AiUsage[];
  aiValidations: AiValidation[];
};

/* ------------------------------------------------------------------ */
/* Visual helpers                                                      */
/* ------------------------------------------------------------------ */

type Rag = 'green' | 'amber' | 'red' | 'grey';

const RAG_BG: Record<Rag, string> = {
  green: 'bg-emerald-50 border-emerald-200',
  amber: 'bg-amber-50 border-amber-200',
  red: 'bg-rose-50 border-rose-200',
  grey: 'bg-slate-50 border-slate-200',
};
const RAG_DOT: Record<Rag, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  grey: 'bg-slate-400',
};
const RAG_TEXT: Record<Rag, string> = {
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-rose-700',
  grey: 'text-slate-600',
};
const RAG_PILL: Record<Rag, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-rose-100 text-rose-700',
  grey: 'bg-slate-100 text-slate-600',
};

function ragFromPct(pct: number | null): Rag {
  if (pct === null || isNaN(pct)) return 'grey';
  if (pct >= 85) return 'green';
  if (pct >= 70) return 'amber';
  return 'red';
}

/* Activity type icon + label */
const ACTIVITY_META: Record<string, { label: string; icon: typeof Snowflake }> = {
  cold: { label: 'Cold file reviews', icon: Snowflake },
  hot: { label: 'Hot file reviews (new RIs/managers)', icon: Flame },
  spot: { label: 'Spot reviews', icon: FileSearch },
  thematic: { label: 'Thematic reviews', icon: BarChart3 },
  eqr: { label: 'EQR process review', icon: ClipboardCheck },
  consultation: { label: 'Consultations (technical)', icon: Sparkles },
  preissuance: { label: 'FS pre-issuance review (PIE/listed)', icon: ShieldCheck },
  ethical: { label: 'Ethical compliance review', icon: Scale },
};

const PILLAR_META: Record<string, { name: string; defaultStrapline: string }> = {
  goodwill: { name: 'Goodwill', defaultStrapline: 'Reputation capital — branding, industry, people' },
  governance: { name: 'Governance', defaultStrapline: 'Tone, principles, risks and digital enablement' },
  growth: { name: 'Growth', defaultStrapline: 'Market proposition, capabilities and commercials' },
  quality: { name: 'Quality', defaultStrapline: 'Monitoring, RCA, remediation and ISQM(UK)1' },
};

const ROOT_CAUSE_LABEL: Record<string, string> = {
  process: 'Process',
  methodology: 'Methodology',
  supervision: 'Supervision/EQR',
  data_ipe: 'Data quality (IPE)',
  resourcing: 'Resourcing',
  other: 'Other',
};

const ISQM_OBJECTIVE_LABEL: Record<string, string> = {
  governance_leadership: 'Governance & leadership',
  ethics: 'Relevant ethical requirements',
  acceptance_continuance: 'Acceptance & continuance',
  engagement_performance: 'Engagement performance',
  resources: 'Resources (people, technology, IP)',
  information_communication: 'Information & communication',
  monitoring_remediation: 'Monitoring & remediation',
  risk_assessment: 'Risk assessment process',
};

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ------------------------------------------------------------------ */
/* Section primitives                                                  */
/* ------------------------------------------------------------------ */

function SectionHeader({ icon: Icon, title, subtitle, right }: { icon: typeof ActivityIcon; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-slate-700" />
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-200 rounded-lg p-4 ${className}`}>{children}</div>;
}

function ProgressBar({ pct, rag }: { pct: number; rag: Rag }) {
  const fill = rag === 'green' ? 'bg-emerald-500' : rag === 'amber' ? 'bg-amber-500' : rag === 'red' ? 'bg-rose-500' : 'bg-slate-400';
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${fill} rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function EmptyState({ icon: Icon, message, ctaLabel, ctaHref }: { icon: typeof ActivityIcon; message: string; ctaLabel?: string; ctaHref?: string }) {
  return (
    <Card className="flex flex-col items-center justify-center py-10 text-center bg-slate-50/50 border-dashed">
      <Icon className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">{message}</p>
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="mt-3 inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-md hover:bg-slate-50 text-slate-700">
          <Settings className="h-3 w-3" /> {ctaLabel}
        </Link>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export function PerformanceDashboardClient() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pillarFilter, setPillarFilter] = useState<string>('All');
  const [year, setYear] = useState<number>(new Date().getFullYear());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/methodology-admin/performance-dashboard/summary');
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json: Summary = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Refresh every 90s — keeps the AQT lead's view current as the team updates
  // monitoring activities / findings / remediations across the day.
  useEffect(() => {
    const id = setInterval(() => { load(); }, 90_000);
    return () => clearInterval(id);
  }, []);

  /* ---------------- Derived metrics ---------------- */
  const headlineKpis = useMemo(() => {
    if (!data) return null;

    const acts = data.monitoringActivities;
    const completed = acts.filter(a => a.status === 'complete' && typeof a.qualityScore === 'number');
    const qualityScore = completed.length
      ? Math.round(completed.reduce((s, a) => s + (a.qualityScore as number), 0) / completed.length)
      : null;

    const totalFindings = data.findings.length;
    const rcaClosed = data.findings.filter(f => f.rcaCompletedDate || f.status === 'rca_complete' || f.status === 'closed').length;
    const rcaClosurePct = totalFindings ? Math.round((rcaClosed / totalFindings) * 100) : null;

    const reTested = data.remediations.filter(r => r.effective !== null);
    const effective = reTested.filter(r => r.effective === true).length;
    const remediationEffectivenessPct = reTested.length ? Math.round((effective / reTested.length) * 100) : null;

    const isqmTotal = data.isqmEvidence.reduce((s, e) => s + e.targetCount, 0);
    const isqmHave = data.isqmEvidence.reduce((s, e) => s + Math.min(e.evidenceCount, e.targetCount), 0);
    const isqmReadinessPct = isqmTotal ? Math.round((isqmHave / isqmTotal) * 100) : null;

    return [
      { key: 'quality', label: 'Audit Quality Score', value: qualityScore, suffix: '/100', icon: Award, sub: 'Avg quality score across completed monitoring activities', empty: 'Capture monitoring activity outcome scores' },
      { key: 'rca', label: 'RCA Closure Rate', value: rcaClosurePct, suffix: '%', icon: Search, sub: 'Findings with completed root-cause analysis', empty: 'Log findings + RCA completion' },
      { key: 'remed', label: 'Remediation Effectiveness', value: remediationEffectivenessPct, suffix: '%', icon: ShieldCheck, sub: 'Remediations re-tested as effective', empty: 'Re-test remediations to populate' },
      { key: 'isqm', label: 'ISQM(UK)1 Readiness', value: isqmReadinessPct, suffix: '%', icon: Target, sub: 'Evidence captured against quality objectives', empty: 'Set ISQM(UK)1 evidence targets' },
    ];
  }, [data]);

  const pillarPerformance = useMemo(() => {
    if (!data) return null;

    // For the Quality pillar specifically we blend operational evidence
    // (monitoring completion, RCA closure, remediation effectiveness) with
    // any CSFs the firm has tagged to the pillar. Non-Quality pillars use
    // CSF RAG mix only — that's where their measurable evidence lives.
    const monitoringPlanned = data.monitoringActivities.length;
    const monitoringComplete = data.monitoringActivities.filter(a => a.status === 'complete').length;
    const monitoringPct = monitoringPlanned ? (monitoringComplete / monitoringPlanned) * 100 : null;

    const totalFindings = data.findings.length;
    const rcaClosed = data.findings.filter(f => f.rcaCompletedDate || f.status === 'rca_complete' || f.status === 'closed').length;
    const rcaPct = totalFindings ? (rcaClosed / totalFindings) * 100 : null;

    const reTested = data.remediations.filter(r => r.effective !== null);
    const effective = reTested.filter(r => r.effective === true).length;
    const remediationPct = reTested.length ? (effective / reTested.length) * 100 : null;

    return (['goodwill', 'governance', 'growth', 'quality'] as const).map((pillar) => {
      const override = data.pillarScores.find(p => p.pillar === pillar);
      const pillarCsfs = data.csfs.filter(c => c.pillar === pillar && c.isActive);
      const ragCounts = pillarCsfs.reduce((acc, c) => {
        acc[c.rag] = (acc[c.rag] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      // CSF auto-derive: green=100, amber=60, red=20, grey ignored
      const scoredCsfs = pillarCsfs.filter(c => c.rag !== 'grey');
      const csfScore = scoredCsfs.length
        ? Math.round(scoredCsfs.reduce((s, c) => s + (c.rag === 'green' ? 100 : c.rag === 'amber' ? 60 : 20), 0) / scoredCsfs.length)
        : null;

      let autoScore: number | null = csfScore;

      // Quality pillar — blend CSF / monitoring / RCA / remediation equally
      // across whichever signals have data. If no signals, autoScore stays null.
      if (pillar === 'quality') {
        const signals: number[] = [];
        if (csfScore !== null) signals.push(csfScore);
        if (monitoringPct !== null) signals.push(monitoringPct);
        if (rcaPct !== null) signals.push(rcaPct);
        if (remediationPct !== null) signals.push(remediationPct);
        autoScore = signals.length ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length) : null;
      }

      const score = override?.manualScore ?? autoScore;
      const strapline = override?.strapline || PILLAR_META[pillar].defaultStrapline;

      // Sub-components: CSFs grouped by sub-component, plus synthetic
      // operational sub-components for the Quality pillar.
      const subComponents = Array.from(new Set(pillarCsfs.map(c => c.subComponent))).map(sc => {
        const csfsInSub = pillarCsfs.filter(c => c.subComponent === sc);
        const worst: Rag = csfsInSub.some(c => c.rag === 'red') ? 'red' :
                          csfsInSub.some(c => c.rag === 'amber') ? 'amber' :
                          csfsInSub.every(c => c.rag === 'green') && csfsInSub.length ? 'green' : 'grey';
        return { name: sc, rag: worst, csfCount: csfsInSub.length };
      });

      if (pillar === 'quality') {
        if (monitoringPct !== null && !subComponents.some(s => s.name === 'Monitoring plan')) {
          subComponents.push({ name: 'Monitoring plan', rag: ragFromPct(monitoringPct), csfCount: 0 });
        }
        if (rcaPct !== null && !subComponents.some(s => s.name === 'Root cause analysis')) {
          subComponents.push({ name: 'Root cause analysis', rag: ragFromPct(rcaPct), csfCount: 0 });
        }
        if (remediationPct !== null && !subComponents.some(s => s.name === 'Remediation')) {
          subComponents.push({ name: 'Remediation', rag: ragFromPct(remediationPct), csfCount: 0 });
        }
      }

      return { pillar, name: PILLAR_META[pillar].name, score, strapline, subComponents, ragCounts };
    });
  }, [data]);

  const monitoringSummary = useMemo(() => {
    if (!data) return [] as { id: string; meta: typeof ACTIVITY_META[string]; planned: number; complete: number; inProgress: number; overdue: number; totalFindings: number }[];
    return Object.keys(ACTIVITY_META).map(id => {
      const rows = data.monitoringActivities.filter(a => a.activityType === id);
      return {
        id,
        meta: ACTIVITY_META[id],
        planned: rows.length,
        complete: rows.filter(r => r.status === 'complete').length,
        inProgress: rows.filter(r => r.status === 'in_progress').length,
        overdue: rows.filter(r => r.status === 'overdue').length,
        totalFindings: rows.reduce((s, r) => s + r.findingsCount, 0),
      };
    });
  }, [data]);

  const teamPerformance = useMemo(() => {
    if (!data) return [];
    const byPerson = new Map<string, { name: string; activities: number; avgScore: number | null; openFindings: number }>();
    data.monitoringActivities.forEach(a => {
      const name = a.responsibleIndividualName || a.managerName;
      if (!name) return;
      const existing = byPerson.get(name) || { name, activities: 0, avgScore: null, openFindings: 0 };
      existing.activities += 1;
      if (typeof a.qualityScore === 'number') {
        const prevScore = existing.avgScore ?? a.qualityScore;
        existing.avgScore = Math.round((prevScore + a.qualityScore) / 2);
      }
      byPerson.set(name, existing);
    });
    // Open findings — by activity → person
    const personByActivity = new Map<string, string>();
    data.monitoringActivities.forEach(a => {
      const name = a.responsibleIndividualName || a.managerName;
      if (name) personByActivity.set(a.id, name);
    });
    data.findings.forEach(f => {
      if (f.status === 'closed' || !f.activityId) return;
      const name = personByActivity.get(f.activityId);
      if (!name) return;
      const existing = byPerson.get(name);
      if (existing) existing.openFindings += 1;
    });
    return Array.from(byPerson.values()).sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));
  }, [data]);

  const rcaCategories = useMemo(() => {
    if (!data) return [];
    const cats = ['process', 'methodology', 'supervision', 'data_ipe', 'resourcing', 'other'];
    return cats.map(category => {
      const rows = data.findings.filter(f => f.rootCauseCategory === category);
      const open = rows.filter(r => r.status !== 'closed').length;
      const closed = rows.filter(r => r.status === 'closed').length;
      const ages = rows.filter(r => r.status !== 'closed').map(r => Math.floor((Date.now() - new Date(r.raisedDate).getTime()) / (1000 * 60 * 60 * 24)));
      const ageAvg = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null;
      return { category, label: ROOT_CAUSE_LABEL[category], open, closed, total: rows.length, ageAvg };
    }).filter(c => c.total > 0);
  }, [data]);

  const filteredCsfs = useMemo(() => {
    if (!data) return [];
    return data.csfs.filter(c => c.isActive && (pillarFilter === 'All' || c.pillar === pillarFilter.toLowerCase()));
  }, [data, pillarFilter]);

  const latestPeople = data?.peopleSnapshots[0] ?? null;

  const ganttForYear = useMemo(() => {
    if (!data) return MONTH_LABELS.map((m, i) => ({ month: m, monthIndex: i, activities: [] as ScheduleItem[] }));
    return MONTH_LABELS.map((m, i) => ({
      month: m,
      monthIndex: i,
      activities: data.activitySchedule.filter(s => s.year === year && s.monthIndex === i),
    }));
  }, [data, year]);

  const isqmReady = useMemo(() => {
    if (!data) return [];
    return Object.keys(ISQM_OBJECTIVE_LABEL).map(objective => {
      const row = data.isqmEvidence.find(e => e.objective === objective);
      const target = row?.targetCount ?? 0;
      const have = row?.evidenceCount ?? 0;
      const evidencePct = target ? Math.min(100, Math.round((have / target) * 100)) : null;
      const rag: Rag = row?.ragManual && (row.rag === 'green' || row.rag === 'amber' || row.rag === 'red' || row.rag === 'grey')
        ? (row.rag as Rag)
        : ragFromPct(evidencePct);
      return { objective, label: ISQM_OBJECTIVE_LABEL[objective], evidencePct, rag, have, target };
    });
  }, [data]);

  const overdueActivities = monitoringSummary.reduce((s, a) => s + a.overdue, 0);

  /* ---------------- AI Reliance Defensibility ---------------- */
  // The defensibility score is a weighted blend of four regulator-meaningful
  // measures. Each component is a 0-100 percentage; missing data drops out
  // of the average rather than scoring zero, so a partly-populated registry
  // doesn't unfairly tank the score.
  //
  //  1. Validation currency  — % of active high/critical risk tools with a
  //     validation test in the last 12 months. The first thing a regulator
  //     asks: "did you test these tools?"
  //  2. Approval coverage   — % of active tools that are explicitly
  //     approved for production use (with named approver). Demonstrates
  //     gating, not informal adoption.
  //  3. Human review evidence — proportion of logged AI uses where the
  //     reviewer engaged (any decision other than "accepted"). Healthy band
  //     5–25%; treated as 100 inside that band, scaled outside.
  //  4. Test pass rate      — % of validation tests in the last 12 months
  //     that passed. Demonstrates the tools actually work.
  const aiDefensibility = useMemo(() => {
    if (!data) return null;
    const activeTools = data.aiTools.filter(t => t.isActive);
    if (activeTools.length === 0) return null;

    const now = Date.now();
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;

    // 1. Validation currency for high/critical tools
    const sensitiveTools = activeTools.filter(t => t.riskRating === 'high' || t.riskRating === 'critical');
    const sensitiveValidated = sensitiveTools.filter(t => t.lastValidatedDate && new Date(t.lastValidatedDate).getTime() >= yearAgo).length;
    const validationCurrencyPct = sensitiveTools.length ? (sensitiveValidated / sensitiveTools.length) * 100 : null;

    // 2. Approval coverage
    const approved = activeTools.filter(t => t.approvedForUse).length;
    const approvalCoveragePct = (approved / activeTools.length) * 100;

    // 3. Human review evidence
    const recentUsage = data.aiUsage.filter(u => new Date(u.usedDate).getTime() >= yearAgo);
    let reviewEvidencePct: number | null = null;
    if (recentUsage.length >= 5) {
      const overrideCount = recentUsage.filter(u => u.outputDecision !== 'accepted').length;
      const overrideRate = (overrideCount / recentUsage.length) * 100;
      // Healthy band 5-25 → 100. Outside the band, scale linearly.
      if (overrideRate >= 5 && overrideRate <= 25) reviewEvidencePct = 100;
      else if (overrideRate < 5) reviewEvidencePct = (overrideRate / 5) * 100;
      else reviewEvidencePct = Math.max(0, 100 - ((overrideRate - 25) * 2));
    }

    // 4. Test pass rate
    const recentTests = data.aiValidations.filter(v => new Date(v.testDate).getTime() >= yearAgo);
    const testPassRatePct = recentTests.length ? (recentTests.filter(v => v.result === 'pass').length / recentTests.length) * 100 : null;

    const components = [validationCurrencyPct, approvalCoveragePct, reviewEvidencePct, testPassRatePct].filter((v): v is number => v !== null);
    const score = components.length ? Math.round(components.reduce((a, b) => a + b, 0) / components.length) : null;

    // Tool-level overdue count
    const today = new Date();
    const overdueTools = activeTools.filter(t => t.nextValidationDue && new Date(t.nextValidationDue) < today).length;
    const unapprovedHighRisk = activeTools.filter(t => !t.approvedForUse && (t.riskRating === 'high' || t.riskRating === 'critical')).length;

    return {
      score,
      validationCurrencyPct: validationCurrencyPct === null ? null : Math.round(validationCurrencyPct),
      approvalCoveragePct: Math.round(approvalCoveragePct),
      reviewEvidencePct: reviewEvidencePct === null ? null : Math.round(reviewEvidencePct),
      testPassRatePct: testPassRatePct === null ? null : Math.round(testPassRatePct),
      activeToolsCount: activeTools.length,
      sensitiveToolsCount: sensitiveTools.length,
      recentUsageCount: recentUsage.length,
      recentTestsCount: recentTests.length,
      overdueTools,
      unapprovedHighRisk,
    };
  }, [data]);

  /* ---------------- Render ---------------- */

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50 text-sm text-rose-700">
        Failed to load Performance Dashboard data: {error}
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ */}
      {/* Toolbar                                                       */}
      {/* ------------------------------------------------------------ */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">G3Q Operational Model · live data</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            data-howto-id="pd.toolbar.refresh"
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <Link
            href="/methodology-admin/performance-dashboard/admin"
            data-howto-id="pd.toolbar.manage-data"
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800"
          >
            <Settings className="h-3 w-3" /> Manage data
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Headline KPIs                                                 */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.headline-kpis">
        <SectionHeader icon={LineChart} title="Headline KPIs" subtitle="Quality at the centre — the four metrics the AQT lead reports to the Management Board" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {headlineKpis?.map((k) => {
            const rag = ragFromPct(k.value);
            const Icon = k.icon;
            const hasValue = k.value !== null;
            return (
              <Card key={k.key} className={`${hasValue ? RAG_BG[rag] : 'bg-slate-50 border-slate-200'} border-l-4`}>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 ${hasValue ? RAG_TEXT[rag] : 'text-slate-400'}`} />
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{k.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    {hasValue ? (
                      <>
                        <span className={`text-3xl font-bold ${RAG_TEXT[rag]}`}>{k.value}</span>
                        <span className="text-sm text-slate-500">{k.suffix}</span>
                      </>
                    ) : (
                      <span className="text-sm text-slate-400 italic">No data yet</span>
                    )}
                  </div>
                  {hasValue && <ProgressBar pct={k.value as number} rag={rag} />}
                  <p className="text-[11px] text-slate-500">{hasValue ? k.sub : k.empty}</p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* G3Q Pillar performance                                        */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.pillars">
        <SectionHeader
          icon={Target}
          title="G3Q Pillar Performance"
          subtitle="Pillar score derived from active CSF RAG mix — or set manually under Manage data"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {pillarPerformance?.map((p) => {
            const rag = ragFromPct(p.score);
            const hasScore = p.score !== null;
            return (
              <Card key={p.pillar} className={`${hasScore ? RAG_BG[rag] : 'bg-slate-50 border-slate-200'} space-y-3`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{p.name}</h3>
                  <div className="flex items-baseline gap-1">
                    {hasScore ? (
                      <>
                        <span className={`text-2xl font-bold ${RAG_TEXT[rag]}`}>{p.score}</span>
                        <span className="text-[11px] text-slate-500">/100</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">No CSFs</span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-600">{p.strapline}</p>
                {hasScore && <ProgressBar pct={p.score as number} rag={rag} />}
                {p.subComponents.length > 0 ? (
                  <div className="space-y-1.5 pt-2 border-t border-white/60">
                    {p.subComponents.map((c) => (
                      <div key={c.name} className="flex items-start gap-1.5">
                        <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${RAG_DOT[c.rag]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-slate-700">{c.name}</div>
                          <div className="text-[10px] text-slate-500 leading-tight">{c.csfCount === 0 ? 'operational signal' : `${c.csfCount} CSF${c.csfCount === 1 ? '' : 's'}`}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 italic pt-2 border-t border-white/60">No CSFs configured</p>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Quality monitoring activities                                 */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.monitoring">
        <SectionHeader
          icon={ClipboardCheck}
          title="Quality Monitoring Activities"
          subtitle="Cold/hot/spot/thematic file reviews, EQR, pre-issuance, consultations and ethical compliance"
          right={
            overdueActivities > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                <AlertTriangle className="h-3 w-3" /> {overdueActivities} overdue across plan
              </span>
            ) : undefined
          }
        />
        {data && data.monitoringActivities.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            message="No monitoring activities logged yet."
            ctaLabel="Add monitoring activities"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=monitoring"
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                  <th className="px-3 py-2 text-left">Activity</th>
                  <th className="px-2 py-2 text-center w-20">Logged</th>
                  <th className="px-2 py-2 text-center w-20">Complete</th>
                  <th className="px-2 py-2 text-center w-20">In progress</th>
                  <th className="px-2 py-2 text-center w-20">Overdue</th>
                  <th className="px-2 py-2 text-left w-40">Completion</th>
                  <th className="px-2 py-2 text-center w-20">Findings</th>
                </tr>
              </thead>
              <tbody>
                {monitoringSummary.map((a) => {
                  const Icon = a.meta.icon;
                  const completionPct = a.planned ? (a.complete / a.planned) * 100 : 0;
                  const rag: Rag = a.overdue > 1 ? 'red' : a.overdue === 1 ? 'amber' : a.complete === a.planned && a.planned > 0 ? 'green' : 'grey';
                  return (
                    <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-slate-500" />
                          <span className="font-medium text-slate-700">{a.meta.label}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center text-slate-600">{a.planned || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-2 text-center font-semibold text-emerald-700">{a.complete || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-2 text-center text-amber-700">{a.inProgress || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-2 text-center">
                        {a.overdue > 0 ? (
                          <span className="text-rose-700 font-semibold">{a.overdue}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {a.planned > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1"><ProgressBar pct={completionPct} rag={rag} /></div>
                            <span className="text-[10px] text-slate-500 w-9 text-right">{Math.round(completionPct)}%</span>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-slate-600">{a.totalFindings || <span className="text-slate-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Team performance matrix                                       */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.team">
        <SectionHeader
          icon={Users}
          title="Team Performance"
          subtitle="Derived from monitoring activities — RIs and managers ranked by avg quality score"
          right={
            <Link
              href="/methodology-admin/performance-dashboard/admin?tab=monitoring"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              Manage activities <ArrowUpRight className="h-3 w-3" />
            </Link>
          }
        />
        {teamPerformance.length === 0 ? (
          <EmptyState
            icon={Users}
            message="No individual performance data yet — add monitoring activities with an RI or manager assigned."
            ctaLabel="Add monitoring activities"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=monitoring"
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                  <th className="px-3 py-2 text-left">Individual</th>
                  <th className="px-2 py-2 text-center w-32">Activities reviewed</th>
                  <th className="px-2 py-2 text-center w-32">Avg quality score</th>
                  <th className="px-2 py-2 text-center w-32">Open findings</th>
                </tr>
              </thead>
              <tbody>
                {teamPerformance.map((t) => {
                  const rag = ragFromPct(t.avgScore);
                  return (
                    <tr key={t.name} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${RAG_DOT[rag]}`} />
                          <span className="font-medium text-slate-800">{t.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center text-slate-600">{t.activities}</td>
                      <td className="px-2 py-2 text-center">
                        {t.avgScore !== null ? (
                          <span className={`font-semibold ${RAG_TEXT[rag]}`}>{t.avgScore}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          t.openFindings >= 5 ? 'bg-rose-100 text-rose-700' : t.openFindings >= 3 ? 'bg-amber-100 text-amber-700' : t.openFindings > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>{t.openFindings}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* RCA + Remediation                                             */}
      {/* ------------------------------------------------------------ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div data-howto-id="pd.section.rca">
          <SectionHeader
            icon={Search}
            title="Root Cause Analysis"
            subtitle="Findings categorised by underlying cause — closure rate and average open age"
          />
          {rcaCategories.length === 0 ? (
            <EmptyState
              icon={Search}
              message="No findings categorised yet."
              ctaLabel="Add findings"
              ctaHref="/methodology-admin/performance-dashboard/admin?tab=findings"
            />
          ) : (
            <Card>
              <div className="space-y-3">
                {rcaCategories.map((r) => {
                  const closurePct = r.total ? (r.closed / r.total) * 100 : 0;
                  const ageRag: Rag = r.ageAvg === null ? 'grey' : r.ageAvg > 30 ? 'red' : r.ageAvg > 21 ? 'amber' : 'green';
                  return (
                    <div key={r.category} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">{r.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500">
                            <span className="text-rose-600 font-semibold">{r.open}</span> open ·{' '}
                            <span className="text-emerald-700 font-semibold">{r.closed}</span> closed
                          </span>
                          {r.ageAvg !== null && (
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${RAG_PILL[ageRag]}`}>
                              avg {r.ageAvg}d
                            </span>
                          )}
                        </div>
                      </div>
                      <ProgressBar pct={closurePct} rag={ragFromPct(closurePct)} />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        <div data-howto-id="pd.section.remediation">
          <SectionHeader
            icon={ShieldCheck}
            title="Remediation Tracker"
            subtitle="Half-yearly effectiveness reporting (Jul/Jan) — has the issue stopped reoccurring?"
          />
          {data && data.remediations.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              message="No remediation actions recorded yet."
              ctaLabel="Add remediation actions"
              ctaHref="/methodology-admin/performance-dashboard/admin?tab=remediations"
            />
          ) : (
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-2 py-2 text-left w-24">Owner</th>
                    <th className="px-2 py-2 text-left w-24">Due</th>
                    <th className="px-2 py-2 text-left w-28">Status</th>
                    <th className="px-2 py-2 text-center w-20">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.remediations.slice(0, 10).map((r) => {
                    const statusPill =
                      r.status === 'overdue' ? 'bg-rose-100 text-rose-700' :
                      r.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                      r.status === 'implemented' || r.status === 'retested' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-slate-100 text-slate-600';
                    return (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-700">{r.description}</td>
                        <td className="px-2 py-2 text-slate-600">{r.ownerName || '—'}</td>
                        <td className="px-2 py-2 text-slate-600">{r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusPill}`}>{r.status.replace('_', ' ')}</span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {r.effective === true && <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" />}
                          {r.effective === false && <AlertTriangle className="h-4 w-4 text-rose-600 mx-auto" />}
                          {r.effective === null && <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* CSF Tracker                                                   */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.csfs">
        <SectionHeader
          icon={Megaphone}
          title="Critical Success Factors"
          subtitle="The CSFs defined in the G3Q AQMP — measurable, owned, time-bound"
          right={
            data && data.csfs.length > 0 ? (
              <select
                value={pillarFilter}
                onChange={(e) => setPillarFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
              >
                <option value="All">All pillars</option>
                <option value="Goodwill">Goodwill</option>
                <option value="Governance">Governance</option>
                <option value="Growth">Growth</option>
                <option value="Quality">Quality</option>
              </select>
            ) : undefined
          }
        />
        {filteredCsfs.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            message={data && data.csfs.length === 0 ? 'No CSFs configured yet.' : 'No CSFs match this filter.'}
            ctaLabel="Add CSFs"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=csfs"
          />
        ) : (
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              {filteredCsfs.map((c) => {
                const rag: Rag = (['green', 'amber', 'red', 'grey'] as const).includes(c.rag as Rag) ? (c.rag as Rag) : 'grey';
                return (
                  <div key={c.id} className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-b-0">
                    <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${RAG_DOT[rag]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                        {PILLAR_META[c.pillar]?.name || c.pillar} — {c.subComponent}
                      </div>
                      <div className="text-xs font-medium text-slate-800">{c.name}</div>
                      {(c.targetMetric || c.currentMetric) && (
                        <div className="text-[11px] text-slate-500">
                          {c.currentMetric ? <span>{c.currentMetric}</span> : null}
                          {c.targetMetric ? <span className="text-slate-400"> · target: {c.targetMetric}</span> : null}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* People metrics                                                */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.people">
        <SectionHeader
          icon={GraduationCap}
          title="Training & People"
          subtitle={latestPeople ? `Latest snapshot — ${latestPeople.periodLabel}` : 'Periodic snapshots from the AQMP people-metrics review cycle'}
        />
        {!latestPeople ? (
          <EmptyState
            icon={GraduationCap}
            message="No people-metric snapshots recorded yet."
            ctaLabel="Add a snapshot"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=people"
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Training effectiveness', value: latestPeople.trainingEffectivenessPct, suffix: '%', icon: GraduationCap, ragMode: 'pct' as const },
              { label: 'Staff utilisation', value: latestPeople.staffUtilisationPct, suffix: '%', icon: ActivityIcon, ragMode: 'utilisation' as const },
              { label: 'Culture survey score', value: latestPeople.cultureSurveyScore, suffix: '/5', icon: Heart, ragMode: 'score5' as const },
              { label: 'Annualised attrition', value: latestPeople.attritionPct, suffix: '%', icon: TrendingDown, ragMode: 'attrition' as const },
            ].map((m) => {
              const Icon = m.icon;
              const v = m.value;
              let rag: Rag = 'grey';
              if (v !== null) {
                if (m.ragMode === 'pct') rag = ragFromPct(v);
                else if (m.ragMode === 'score5') rag = v >= 4 ? 'green' : v >= 3 ? 'amber' : 'red';
                else if (m.ragMode === 'attrition') rag = v <= 12 ? 'green' : v <= 18 ? 'amber' : 'red';
                else if (m.ragMode === 'utilisation') rag = v >= 75 && v <= 90 ? 'green' : v >= 65 ? 'amber' : 'red';
              }
              return (
                <Card key={m.label} className={v !== null ? RAG_BG[rag] : 'bg-slate-50 border-slate-200'}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon className={`h-3.5 w-3.5 ${v !== null ? RAG_TEXT[rag] : 'text-slate-400'}`} />
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{m.label}</span>
                  </div>
                  {v !== null ? (
                    <>
                      <div className={`text-2xl font-bold ${RAG_TEXT[rag]}`}>{v}{m.suffix}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{latestPeople.periodLabel}</div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-400 italic">No value</div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Annual activity calendar                                      */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.schedule">
        <SectionHeader
          icon={Calendar}
          title="Annual Activity Schedule"
          subtitle="The G3Q Gantt — what is due, in flight, on track or overdue across the AQMP"
          right={
            <div className="flex items-center gap-3">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
              >
                {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> done</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> on track</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> at risk</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> overdue</span>
              </div>
            </div>
          }
        />
        {data && data.activitySchedule.length === 0 ? (
          <EmptyState
            icon={Calendar}
            message="No annual activity schedule entries for any year yet."
            ctaLabel="Build the schedule"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=schedule"
          />
        ) : (
          <Card className="p-0 overflow-x-auto">
            <div className="grid grid-cols-12 min-w-[960px]">
              {ganttForYear.map((m) => (
                <div key={m.month} className="border-r border-slate-100 last:border-r-0">
                  <div className="px-2 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-700 text-center">
                    {m.month}
                  </div>
                  <div className="p-2 space-y-1 min-h-[60px]">
                    {m.activities.length === 0 ? (
                      <div className="text-[10px] text-slate-300 italic text-center pt-2">—</div>
                    ) : m.activities.map((a) => {
                      const dot =
                        a.status === 'done' ? 'bg-emerald-500' :
                        a.status === 'on_track' ? 'bg-blue-500' :
                        a.status === 'at_risk' ? 'bg-amber-500' :
                        a.status === 'overdue' ? 'bg-rose-500' :
                        'bg-slate-400';
                      return (
                        <div key={a.id} className="flex items-start gap-1.5 text-[10px]">
                          <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
                          <span className="text-slate-600 leading-tight">{a.activityName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* AI Reliance Defensibility                                     */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.ai-reliance">
        <SectionHeader
          icon={Bot}
          title="AI Reliance Defensibility"
          subtitle="Regulator-facing evidence that the firm's use of AI is registered, validated, and human-supervised — aligned to ISQM(UK)1 and ISA 220 (Revised) on automated tools and techniques"
          right={
            <Link
              href="/methodology-admin/performance-dashboard/admin?tab=ai"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              Manage AI register <ArrowUpRight className="h-3 w-3" />
            </Link>
          }
        />
        {!aiDefensibility ? (
          <EmptyState
            icon={Bot}
            message="No AI tools registered yet — the regulator-defensible position starts with a complete AI tool registry."
            ctaLabel="Register AI tools"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=ai"
          />
        ) : (
          <div className="space-y-4">
            {/* Headline + four sub-scores */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {(() => {
                const rag = ragFromPct(aiDefensibility.score);
                const hasScore = aiDefensibility.score !== null;
                return (
                  <Card className={`${hasScore ? RAG_BG[rag] : 'bg-slate-50 border-slate-200'} border-l-4 md:col-span-1`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Bot className={`h-3.5 w-3.5 ${hasScore ? RAG_TEXT[rag] : 'text-slate-400'}`} />
                      <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Defensibility</span>
                    </div>
                    {hasScore ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-3xl font-bold ${RAG_TEXT[rag]}`}>{aiDefensibility.score}</span>
                          <span className="text-sm text-slate-500">/100</span>
                        </div>
                        <ProgressBar pct={aiDefensibility.score as number} rag={rag} />
                      </>
                    ) : (
                      <span className="text-sm text-slate-400 italic">No data yet</span>
                    )}
                    <p className="text-[11px] text-slate-500 mt-2">Composite score across the four defensibility components</p>
                  </Card>
                );
              })()}

              {[
                { label: 'Validation currency', value: aiDefensibility.validationCurrencyPct, sub: `${aiDefensibility.sensitiveToolsCount} high/critical tool${aiDefensibility.sensitiveToolsCount === 1 ? '' : 's'}`, hint: 'Tools tested in last 12 months' },
                { label: 'Approval coverage', value: aiDefensibility.approvalCoveragePct, sub: `${aiDefensibility.activeToolsCount} active tools`, hint: 'Tools formally approved for use' },
                { label: 'Human review evidence', value: aiDefensibility.reviewEvidencePct, sub: `${aiDefensibility.recentUsageCount} uses logged (12m)`, hint: 'Healthy override band 5–25%' },
                { label: 'Test pass rate', value: aiDefensibility.testPassRatePct, sub: `${aiDefensibility.recentTestsCount} tests (12m)`, hint: 'Validation tests passed' },
              ].map((m) => {
                const rag = ragFromPct(m.value);
                const hasValue = m.value !== null;
                return (
                  <Card key={m.label} className={hasValue ? RAG_BG[rag] : 'bg-slate-50 border-slate-200'}>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">{m.label}</div>
                    {hasValue ? (
                      <>
                        <div className={`text-2xl font-bold ${RAG_TEXT[rag]}`}>{m.value}%</div>
                        <ProgressBar pct={m.value as number} rag={rag} />
                      </>
                    ) : (
                      <div className="text-sm text-slate-400 italic">No data yet</div>
                    )}
                    <p className="text-[11px] text-slate-500 mt-1">{m.sub}</p>
                    <p className="text-[10px] text-slate-400">{m.hint}</p>
                  </Card>
                );
              })}
            </div>

            {/* Action flags */}
            {(aiDefensibility.overdueTools > 0 || aiDefensibility.unapprovedHighRisk > 0) && (
              <Card className="bg-amber-50 border-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-800 space-y-0.5">
                    {aiDefensibility.overdueTools > 0 && (
                      <div><strong>{aiDefensibility.overdueTools}</strong> tool{aiDefensibility.overdueTools === 1 ? ' has' : 's have'} an overdue validation date — log a validation test or revise the cadence.</div>
                    )}
                    {aiDefensibility.unapprovedHighRisk > 0 && (
                      <div><strong>{aiDefensibility.unapprovedHighRisk}</strong> high/critical-risk tool{aiDefensibility.unapprovedHighRisk === 1 ? ' is' : 's are'} not formally approved for production — withdraw from use or complete approval.</div>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Tool registry summary */}
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                    <th className="px-3 py-2 text-left">Tool</th>
                    <th className="px-2 py-2 text-left w-24">Risk</th>
                    <th className="px-2 py-2 text-left w-28">Validation</th>
                    <th className="px-2 py-2 text-left w-24">Last tested</th>
                    <th className="px-2 py-2 text-left w-24">Next due</th>
                    <th className="px-2 py-2 text-center w-20">Approved</th>
                    <th className="px-2 py-2 text-center w-20">HITL</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.aiTools.filter(t => t.isActive).map(t => {
                    const overdue = t.nextValidationDue && new Date(t.nextValidationDue) < new Date();
                    const riskCls = t.riskRating === 'critical' ? 'bg-rose-100 text-rose-700' : t.riskRating === 'high' ? 'bg-amber-100 text-amber-700' : t.riskRating === 'medium' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-700';
                    const valCls = t.validationStatus === 'validated' ? 'bg-emerald-100 text-emerald-700' : t.validationStatus === 'withdrawn' ? 'bg-slate-200 text-slate-600' : t.validationStatus === 'under_review' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
                    return (
                      <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">{t.name}</div>
                          {(t.vendor || t.modelVersion) && <div className="text-[11px] text-slate-500">{[t.vendor, t.modelVersion].filter(Boolean).join(' · ')}</div>}
                        </td>
                        <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${riskCls}`}>{t.riskRating}</span></td>
                        <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${valCls}`}>{t.validationStatus.replace('_', ' ')}</span></td>
                        <td className="px-2 py-2 text-slate-600">{t.lastValidatedDate ? new Date(t.lastValidatedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                        <td className={`px-2 py-2 ${overdue ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>{t.nextValidationDue ? new Date(t.nextValidationDue).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                        <td className="px-2 py-2 text-center">{t.approvedForUse ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" /> : <XCircle className="h-4 w-4 text-rose-400 mx-auto" />}</td>
                        <td className="px-2 py-2 text-center">{t.humanInLoop ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" /> : <span className="text-amber-600 text-[10px]">sampling</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* ISQM1 readiness                                               */}
      {/* ------------------------------------------------------------ */}
      <section data-howto-id="pd.section.isqm">
        <SectionHeader
          icon={Target}
          title="ISQM(UK)1 Readiness"
          subtitle="Year-round evidence captured against each quality objective — Oct–Sep period, Dec reporting"
        />
        {data && data.isqmEvidence.length === 0 ? (
          <EmptyState
            icon={Target}
            message="No ISQM(UK)1 evidence targets configured yet."
            ctaLabel="Configure ISQM(UK)1 evidence"
            ctaHref="/methodology-admin/performance-dashboard/admin?tab=isqm"
          />
        ) : (
          <Card>
            <div className="space-y-3">
              {isqmReady.map((o) => (
                <div key={o.objective} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{o.label}</span>
                    {o.evidencePct !== null ? (
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${RAG_PILL[o.rag]}`}>
                        {o.have} / {o.target} · {o.evidencePct}%
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">not configured</span>
                    )}
                  </div>
                  {o.evidencePct !== null && <ProgressBar pct={o.evidencePct} rag={o.rag} />}
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* Footer note */}
      <p className="text-[11px] text-slate-400 text-center pt-4 border-t border-slate-100">
        All values shown are calculated live from data captured in <Link href="/methodology-admin/performance-dashboard/admin" className="text-blue-600 hover:underline">Manage data</Link>.
        Empty panels reflect data not yet entered for this firm.
      </p>
    </div>
  );
}
