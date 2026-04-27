'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileSearch,
  Filter,
  Flame,
  GraduationCap,
  Heart,
  LineChart,
  Megaphone,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* RAG / status helpers                                                */
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

function ragFromScore(score: number): Rag {
  if (score >= 85) return 'green';
  if (score >= 70) return 'amber';
  return 'red';
}

/* ------------------------------------------------------------------ */
/* Illustrative data — wire to live backend in a follow-up pass        */
/* ------------------------------------------------------------------ */

const PERIODS = ['Last 30 days', 'Last quarter', 'YTD 2026', 'Rolling 12 months'] as const;
type Period = (typeof PERIODS)[number];

const HEADLINE_KPIS = [
  {
    label: 'Audit Quality Score',
    value: 82,
    suffix: '/100',
    delta: '+4 vs last quarter',
    deltaDir: 'up' as const,
    icon: Award,
    sub: 'Weighted avg of cold/hot/spot file outcomes',
  },
  {
    label: 'RCA Closure Rate',
    value: 76,
    suffix: '%',
    delta: 'Target 95%',
    deltaDir: 'down' as const,
    icon: Search,
    sub: 'Findings with completed root-cause analysis',
  },
  {
    label: 'Remediation Effectiveness',
    value: 88,
    suffix: '%',
    delta: '+6 vs Jul reporting',
    deltaDir: 'up' as const,
    icon: ShieldCheck,
    sub: 'Issues that did not reoccur after remediation',
  },
  {
    label: 'ISQM(UK)1 Readiness',
    value: 71,
    suffix: '%',
    delta: 'Annual eval Dec',
    deltaDir: 'flat' as const,
    icon: Target,
    sub: 'Year-round evidence captured against quality objectives',
  },
];

type Pillar = {
  key: 'goodwill' | 'governance' | 'growth' | 'quality';
  name: string;
  score: number;
  strapline: string;
  components: { name: string; rag: Rag; note: string }[];
};

const PILLARS: Pillar[] = [
  {
    key: 'goodwill',
    name: 'Goodwill',
    score: 78,
    strapline: 'Reputation capital — branding, industry, people',
    components: [
      { name: 'Branding', rag: 'green', note: 'Marketing strategy on plan; 7 publications YTD' },
      { name: 'Industry', rag: 'amber', note: 'Regulator catch-up overdue (Sep)' },
      { name: 'People', rag: 'amber', note: 'Utilisation 71%; culture survey pending Jul' },
    ],
  },
  {
    key: 'governance',
    name: 'Governance',
    score: 84,
    strapline: 'Tone, principles, risks and digital enablement',
    components: [
      { name: 'Leadership', rag: 'green', note: 'Tone-from-the-top messaging cadence met' },
      { name: 'Risks', rag: 'green', note: 'Ethical review May complete; 0 breaches' },
      { name: 'Digitally led', rag: 'amber', note: 'PM integration Q2 milestone slipped 2 weeks' },
    ],
  },
  {
    key: 'growth',
    name: 'Growth',
    score: 69,
    strapline: 'Market proposition, capabilities and commercials',
    components: [
      { name: 'Market proposition', rag: 'amber', note: '2 of 6 target sectors methodology-ready' },
      { name: 'Capabilities', rag: 'red', note: 'AI tools effectiveness review delayed' },
      { name: 'Commercials', rag: 'amber', note: 'Avg revenue/hr below threshold on 3 portfolios' },
    ],
  },
  {
    key: 'quality',
    name: 'Quality',
    score: 82,
    strapline: 'Monitoring, RCA, remediation and ISQM1',
    components: [
      { name: 'Monitoring plan', rag: 'green', note: 'YTD plan 92% complete' },
      { name: 'Root cause analysis', rag: 'amber', note: '4 RCAs > 30 days outstanding' },
      { name: 'Remediation', rag: 'green', note: '88% effectiveness at re-test' },
    ],
  },
];

type MonitoringActivity = {
  id: string;
  name: string;
  icon: typeof Snowflake;
  planned: number;
  complete: number;
  inProgress: number;
  overdue: number;
  nextDue: string;
  owner: string;
};

const MONITORING_ACTIVITIES: MonitoringActivity[] = [
  { id: 'cold', name: 'Cold file reviews', icon: Snowflake, planned: 24, complete: 18, inProgress: 4, overdue: 2, nextDue: '15 May', owner: 'AQT' },
  { id: 'hot', name: 'Hot file reviews (new RIs/managers)', icon: Flame, planned: 9, complete: 6, inProgress: 2, overdue: 1, nextDue: '08 May', owner: 'AQT' },
  { id: 'spot', name: 'Spot reviews', icon: FileSearch, planned: 12, complete: 9, inProgress: 2, overdue: 1, nextDue: '02 May', owner: 'AQT' },
  { id: 'thematic', name: 'Thematic reviews', icon: BarChart3, planned: 6, complete: 3, inProgress: 2, overdue: 1, nextDue: '30 May', owner: 'AQT + Tech' },
  { id: 'eqr', name: 'EQR process review', icon: ClipboardCheck, planned: 4, complete: 3, inProgress: 1, overdue: 0, nextDue: '20 Jun', owner: 'AQT' },
  { id: 'consult', name: 'Consultations (technical)', icon: Sparkles, planned: 30, complete: 22, inProgress: 6, overdue: 2, nextDue: 'Ongoing', owner: 'Technical' },
  { id: 'preissue', name: 'FS pre-issuance review (PIE/listed)', icon: ShieldCheck, planned: 8, complete: 5, inProgress: 2, overdue: 1, nextDue: '12 May', owner: 'Technical + ACP' },
  { id: 'ethical', name: 'Ethical compliance review', icon: Scale, planned: 6, complete: 4, inProgress: 1, overdue: 1, nextDue: '14 May', owner: 'Ethics Partner' },
];

const TEAM_PERFORMANCE = [
  { name: 'Edmund Cartwright (ACP)', role: 'ACP', portfolio: 8, qualityScore: 91, lastFileRating: 'Good with limited improvements', training: 100, openFindings: 1, rag: 'green' as Rag },
  { name: 'Helena Marsh', role: 'RI', portfolio: 12, qualityScore: 86, lastFileRating: 'Good with limited improvements', training: 92, openFindings: 2, rag: 'green' as Rag },
  { name: 'Daniel Okafor', role: 'RI', portfolio: 11, qualityScore: 78, lastFileRating: 'Improvements required', training: 85, openFindings: 5, rag: 'amber' as Rag },
  { name: 'Priya Anand', role: 'RI (new)', portfolio: 6, qualityScore: 74, lastFileRating: 'Improvements required', training: 96, openFindings: 4, rag: 'amber' as Rag },
  { name: 'Marcus Hale', role: 'Manager', portfolio: 10, qualityScore: 81, lastFileRating: 'Good with limited improvements', training: 88, openFindings: 3, rag: 'green' as Rag },
  { name: 'Sophie Chen', role: 'Manager (new)', portfolio: 7, qualityScore: 68, lastFileRating: 'Significant improvements required', training: 75, openFindings: 7, rag: 'red' as Rag },
  { name: 'Theo Nakamura', role: 'Manager', portfolio: 9, qualityScore: 84, lastFileRating: 'Good with limited improvements', training: 100, openFindings: 2, rag: 'green' as Rag },
];

const RCA_CATEGORIES = [
  { category: 'Process', open: 6, closed: 14, ageAvg: 22 },
  { category: 'Methodology', open: 4, closed: 9, ageAvg: 31 },
  { category: 'Supervision/EQR', open: 3, closed: 7, ageAvg: 18 },
  { category: 'Data quality (IPE)', open: 5, closed: 8, ageAvg: 26 },
  { category: 'Resourcing', open: 2, closed: 4, ageAvg: 35 },
];

const REMEDIATION_ACTIONS = [
  { issue: 'Insufficient walkthroughs on revenue', owner: 'AQT', due: '31 May', status: 'In progress' as const, effective: null },
  { issue: 'Journal entry test scope inconsistent', owner: 'Technical', due: '15 Jun', status: 'In progress' as const, effective: null },
  { issue: 'IPE evidence not retained on file', owner: 'Methodology', due: '30 Apr', status: 'Overdue' as const, effective: null },
  { issue: 'Going concern documentation gaps', owner: 'AQT', due: '20 Mar', status: 'Re-tested' as const, effective: true },
  { issue: 'Group component instructions weak', owner: 'Technical', due: '28 Feb', status: 'Re-tested' as const, effective: true },
  { issue: 'Related parties identification', owner: 'AQT', due: '10 Apr', status: 'Re-tested' as const, effective: false },
];

const CSF_TRACKER: { pillar: string; csf: string; rag: Rag; metric: string }[] = [
  { pillar: 'Goodwill — Branding', csf: 'Expanding presence in global markets', rag: 'amber', metric: '1 of 3 target jurisdictions live' },
  { pillar: 'Goodwill — Industry', csf: 'Building regulator trust', rag: 'green', metric: 'Mar regulatory review complete' },
  { pillar: 'Goodwill — People', csf: 'Training effectiveness improving', rag: 'green', metric: '+8 pts vs Jul-25' },
  { pillar: 'Goodwill — People', csf: 'Staff utilisation in line with industry', rag: 'amber', metric: '71% (target 75–80%)' },
  { pillar: 'Governance — Leadership', csf: 'Quality-first culture surveys', rag: 'grey', metric: 'Survey due Jul' },
  { pillar: 'Governance — Risks', csf: 'No ethical breaches', rag: 'green', metric: '0 YTD' },
  { pillar: 'Governance — Risks', csf: 'On-time FRC/RSB reporting', rag: 'green', metric: '100% on-time' },
  { pillar: 'Governance — Digital', csf: 'PM/quality system integration', rag: 'amber', metric: 'Phase 2 milestone slipped' },
  { pillar: 'Growth — Capabilities', csf: 'AI tool integration into delivery', rag: 'red', metric: 'Effectiveness review delayed' },
  { pillar: 'Growth — Capabilities', csf: 'Decreasing attrition', rag: 'amber', metric: '14% (target <12%)' },
  { pillar: 'Growth — Commercials', csf: 'Avg revenue/hr at threshold', rag: 'amber', metric: '£128 (target £140)' },
  { pillar: 'Quality — Monitoring', csf: 'Plan executed on schedule', rag: 'green', metric: '92% YTD complete' },
];

const PEOPLE_METRICS = [
  { label: 'Training effectiveness', value: '83%', sub: 'Jan/Jul cycle', rag: 'green' as Rag, icon: GraduationCap },
  { label: 'Staff utilisation', value: '71%', sub: 'Quarterly review', rag: 'amber' as Rag, icon: Activity },
  { label: 'Culture survey score', value: '4.1/5', sub: 'Last: Jul-25', rag: 'green' as Rag, icon: Heart },
  { label: 'Annualised attrition', value: '14%', sub: 'Target <12%', rag: 'amber' as Rag, icon: TrendingDown },
];

const GANTT_MONTHS: { month: string; activities: { name: string; status: 'done' | 'on-track' | 'at-risk' | 'overdue' }[] }[] = [
  { month: 'Jan', activities: [
    { name: 'Training effectiveness', status: 'done' },
    { name: 'Capabilities', status: 'done' },
    { name: 'AI Tools effectiveness', status: 'overdue' },
    { name: 'Commercial Fees', status: 'done' },
    { name: 'AQT audit file reviews', status: 'done' },
    { name: 'ICAEW & FRC Annual Return', status: 'done' },
  ] },
  { month: 'Feb', activities: [
    { name: 'Performance reviews', status: 'done' },
    { name: 'Methodologies', status: 'done' },
    { name: 'Attrition review', status: 'done' },
    { name: 'Career paths', status: 'done' },
    { name: 'Tech team scoping', status: 'done' },
  ] },
  { month: 'Mar', activities: [
    { name: 'Publications progress', status: 'done' },
    { name: 'Regulatory review', status: 'done' },
    { name: 'Staff utilisation', status: 'done' },
    { name: 'PM Integration', status: 'overdue' },
    { name: 'Capacity assessment', status: 'done' },
    { name: 'Remuneration', status: 'done' },
    { name: "KPI's review (setting)", status: 'done' },
  ] },
  { month: 'Apr', activities: [
    { name: 'MIS System', status: 'on-track' },
    { name: 'Spot audit quality reviews', status: 'on-track' },
    { name: 'ICAEW CC Annual Return', status: 'done' },
    { name: 'Transparency Report', status: 'on-track' },
  ] },
  { month: 'May', activities: [
    { name: "Client's CSF metrics", status: 'on-track' },
    { name: 'Ethical review', status: 'at-risk' },
    { name: 'Methodologies', status: 'on-track' },
  ] },
  { month: 'Jun', activities: [
    { name: 'Publications progress', status: 'on-track' },
    { name: "KPI's review (firms)", status: 'on-track' },
    { name: 'Staff utilisation', status: 'on-track' },
    { name: 'PM Integration', status: 'at-risk' },
    { name: 'Capacity assessment', status: 'on-track' },
    { name: 'Remediation plan updates', status: 'on-track' },
  ] },
  { month: 'Jul', activities: [
    { name: 'Training effectiveness', status: 'on-track' },
    { name: 'Staff culture surveys', status: 'on-track' },
    { name: 'Risk review', status: 'on-track' },
  ] },
  { month: 'Aug', activities: [
    { name: 'Performance reviews', status: 'on-track' },
    { name: 'Methodologies', status: 'on-track' },
    { name: 'Thematic reviews', status: 'on-track' },
  ] },
  { month: 'Sep', activities: [
    { name: 'Publications progress', status: 'on-track' },
    { name: 'Staff utilisation', status: 'on-track' },
    { name: 'Capacity assessment', status: 'on-track' },
  ] },
  { month: 'Oct', activities: [
    { name: "Client's CSF metrics", status: 'on-track' },
    { name: 'MIS System', status: 'on-track' },
    { name: 'Data security', status: 'on-track' },
  ] },
  { month: 'Nov', activities: [
    { name: "KPI's review (firms)", status: 'on-track' },
    { name: 'Risk review', status: 'on-track' },
    { name: 'Ethical review', status: 'on-track' },
    { name: 'Methodologies', status: 'on-track' },
    { name: 'Remediation plan updates', status: 'on-track' },
  ] },
  { month: 'Dec', activities: [
    { name: 'Governance Review', status: 'on-track' },
    { name: 'Marketing Strategy', status: 'on-track' },
    { name: 'Publications (Plan)', status: 'on-track' },
    { name: 'Sector & Geographies', status: 'on-track' },
    { name: 'AI Tools effectiveness', status: 'on-track' },
    { name: 'ISQM1 Annual Evaluation', status: 'on-track' },
  ] },
];

const ISQM1_OBJECTIVES = [
  { name: 'Governance & leadership', evidence: 86, rag: 'green' as Rag },
  { name: 'Relevant ethical requirements', evidence: 92, rag: 'green' as Rag },
  { name: 'Acceptance & continuance', evidence: 78, rag: 'amber' as Rag },
  { name: 'Engagement performance', evidence: 74, rag: 'amber' as Rag },
  { name: 'Resources (people, technology, IP)', evidence: 65, rag: 'amber' as Rag },
  { name: 'Information & communication', evidence: 80, rag: 'green' as Rag },
  { name: 'Monitoring & remediation', evidence: 71, rag: 'amber' as Rag },
  { name: 'Risk assessment process', evidence: 83, rag: 'green' as Rag },
];

/* ------------------------------------------------------------------ */
/* Section primitives                                                  */
/* ------------------------------------------------------------------ */

function SectionHeader({ icon: Icon, title, subtitle, right }: { icon: typeof Activity; title: string; subtitle?: string; right?: React.ReactNode }) {
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

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export function PerformanceDashboardClient() {
  const [period, setPeriod] = useState<Period>('YTD 2026');
  const [pillarFilter, setPillarFilter] = useState<string>('All');

  const filteredCsfs = useMemo(
    () => CSF_TRACKER.filter((c) => pillarFilter === 'All' || c.pillar.startsWith(pillarFilter)),
    [pillarFilter],
  );

  const overdueActivities = MONITORING_ACTIVITIES.reduce((s, a) => s + a.overdue, 0);

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ */}
      {/* Toolbar                                                       */}
      {/* ------------------------------------------------------------ */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Filter className="h-3 w-3" /> Period:
          </div>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">G3Q Operational Model · v3Q 2026</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-md hover:bg-slate-50">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-md hover:bg-slate-50">
            <Download className="h-3 w-3" /> Export pack
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Headline KPIs                                                 */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader icon={LineChart} title="Headline KPIs" subtitle="Quality at the centre — the four metrics the AQT lead reports to the Management Board" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {HEADLINE_KPIS.map((k) => {
            const rag = ragFromScore(k.value);
            const Icon = k.icon;
            return (
              <Card key={k.label} className={`${RAG_BG[rag]} border-l-4`}>
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`h-3.5 w-3.5 ${RAG_TEXT[rag]}`} />
                      <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{k.label}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-3xl font-bold ${RAG_TEXT[rag]}`}>{k.value}</span>
                      <span className="text-sm text-slate-500">{k.suffix}</span>
                    </div>
                    <ProgressBar pct={k.value} rag={rag} />
                    <div className="flex items-center gap-1 text-[11px]">
                      {k.deltaDir === 'up' && <TrendingUp className="h-3 w-3 text-emerald-600" />}
                      {k.deltaDir === 'down' && <TrendingDown className="h-3 w-3 text-rose-600" />}
                      {k.deltaDir === 'flat' && <Clock className="h-3 w-3 text-slate-400" />}
                      <span className="text-slate-600">{k.delta}</span>
                    </div>
                    <p className="text-[11px] text-slate-500">{k.sub}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* G3Q Pillar performance                                        */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader
          icon={Target}
          title="G3Q Pillar Performance"
          subtitle="Quality at centre, supported by Goodwill, Governance and Growth — drill in for sub-component RAG"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((p) => {
            const rag = ragFromScore(p.score);
            return (
              <Card key={p.key} className={`${RAG_BG[rag]} space-y-3`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{p.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${RAG_TEXT[rag]}`}>{p.score}</span>
                    <span className="text-[11px] text-slate-500">/100</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600">{p.strapline}</p>
                <ProgressBar pct={p.score} rag={rag} />
                <div className="space-y-1.5 pt-2 border-t border-white/60">
                  {p.components.map((c) => (
                    <div key={c.name} className="flex items-start gap-1.5">
                      <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${RAG_DOT[c.rag]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-slate-700">{c.name}</div>
                        <div className="text-[10px] text-slate-500 leading-tight">{c.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Quality monitoring activities                                 */}
      {/* ------------------------------------------------------------ */}
      <section>
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
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Activity</th>
                <th className="px-2 py-2 text-center w-20">Planned</th>
                <th className="px-2 py-2 text-center w-20">Complete</th>
                <th className="px-2 py-2 text-center w-20">In progress</th>
                <th className="px-2 py-2 text-center w-20">Overdue</th>
                <th className="px-2 py-2 text-left w-40">Progress</th>
                <th className="px-2 py-2 text-left w-24">Next due</th>
                <th className="px-2 py-2 text-left w-32">Owner</th>
              </tr>
            </thead>
            <tbody>
              {MONITORING_ACTIVITIES.map((a) => {
                const Icon = a.icon;
                const pct = (a.complete / a.planned) * 100;
                const rag: Rag = a.overdue > 1 ? 'red' : a.overdue === 1 ? 'amber' : 'green';
                return (
                  <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-slate-500" />
                        <span className="font-medium text-slate-700">{a.name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600">{a.planned}</td>
                    <td className="px-2 py-2 text-center font-semibold text-emerald-700">{a.complete}</td>
                    <td className="px-2 py-2 text-center text-amber-700">{a.inProgress}</td>
                    <td className="px-2 py-2 text-center">
                      {a.overdue > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-rose-700 font-semibold">{a.overdue}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1"><ProgressBar pct={pct} rag={rag} /></div>
                        <span className="text-[10px] text-slate-500 w-9 text-right">{Math.round(pct)}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-600">{a.nextDue}</td>
                    <td className="px-2 py-2 text-slate-600">{a.owner}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Team performance matrix                                       */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader
          icon={Users}
          title="Team Performance Matrix"
          subtitle="RIs and managers — quality scores, latest file rating, training and open findings"
          right={
            <button className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
              View full directory <ArrowUpRight className="h-3 w-3" />
            </button>
          }
        />
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Individual</th>
                <th className="px-2 py-2 text-left w-28">Role</th>
                <th className="px-2 py-2 text-center w-20">Portfolio</th>
                <th className="px-2 py-2 text-center w-24">Quality</th>
                <th className="px-2 py-2 text-left w-56">Last file rating</th>
                <th className="px-2 py-2 text-center w-24">Training</th>
                <th className="px-2 py-2 text-center w-24">Open findings</th>
              </tr>
            </thead>
            <tbody>
              {TEAM_PERFORMANCE.map((t) => (
                <tr key={t.name} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${RAG_DOT[t.rag]}`} />
                      <span className="font-medium text-slate-800">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{t.role}</td>
                  <td className="px-2 py-2 text-center text-slate-600">{t.portfolio}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`font-semibold ${RAG_TEXT[ragFromScore(t.qualityScore)]}`}>{t.qualityScore}</span>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{t.lastFileRating}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><ProgressBar pct={t.training} rag={ragFromScore(t.training)} /></div>
                      <span className="text-[10px] text-slate-500 w-9 text-right">{t.training}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      t.openFindings >= 5 ? 'bg-rose-100 text-rose-700' : t.openFindings >= 3 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>{t.openFindings}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* RCA + Remediation                                             */}
      {/* ------------------------------------------------------------ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionHeader
            icon={Search}
            title="Root Cause Analysis"
            subtitle="Findings categorised by underlying cause — process, methodology, supervision, data, resourcing"
          />
          <Card>
            <div className="space-y-3">
              {RCA_CATEGORIES.map((r) => {
                const total = r.open + r.closed;
                const closurePct = total ? (r.closed / total) * 100 : 0;
                const ageRag: Rag = r.ageAvg > 30 ? 'red' : r.ageAvg > 21 ? 'amber' : 'green';
                return (
                  <div key={r.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{r.category}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">
                          <span className="text-rose-600 font-semibold">{r.open}</span> open ·{' '}
                          <span className="text-emerald-700 font-semibold">{r.closed}</span> closed
                        </span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${RAG_PILL[ageRag]}`}>
                          avg {r.ageAvg}d
                        </span>
                      </div>
                    </div>
                    <ProgressBar pct={closurePct} rag={ragFromScore(closurePct)} />
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div>
          <SectionHeader
            icon={ShieldCheck}
            title="Remediation Tracker"
            subtitle="Half-yearly effectiveness reporting (Jul/Jan) — has the issue stopped reoccurring?"
          />
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 uppercase font-semibold">
                  <th className="px-3 py-2 text-left">Issue</th>
                  <th className="px-2 py-2 text-left w-24">Owner</th>
                  <th className="px-2 py-2 text-left w-20">Due</th>
                  <th className="px-2 py-2 text-left w-24">Status</th>
                  <th className="px-2 py-2 text-center w-20">Effective</th>
                </tr>
              </thead>
              <tbody>
                {REMEDIATION_ACTIONS.map((r) => {
                  const statusPill =
                    r.status === 'Overdue' ? 'bg-rose-100 text-rose-700' :
                    r.status === 'In progress' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600';
                  return (
                    <tr key={r.issue} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{r.issue}</td>
                      <td className="px-2 py-2 text-slate-600">{r.owner}</td>
                      <td className="px-2 py-2 text-slate-600">{r.due}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusPill}`}>{r.status}</span>
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
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* CSF Tracker                                                   */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader
          icon={Megaphone}
          title="Critical Success Factors"
          subtitle="The CSFs defined in the G3Q AQMP — measurable, owned, time-bound"
          right={
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
          }
        />
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {filteredCsfs.map((c) => (
              <div key={c.csf} className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-b-0">
                <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${RAG_DOT[c.rag]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{c.pillar}</div>
                  <div className="text-xs font-medium text-slate-800">{c.csf}</div>
                  <div className="text-[11px] text-slate-500">{c.metric}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* People metrics                                                */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader
          icon={GraduationCap}
          title="Training & People"
          subtitle="From the Goodwill–People AQMP — training effectiveness, utilisation, culture, attrition"
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {PEOPLE_METRICS.map((m) => {
            const Icon = m.icon;
            return (
              <Card key={m.label} className={RAG_BG[m.rag]}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className={`h-3.5 w-3.5 ${RAG_TEXT[m.rag]}`} />
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{m.label}</span>
                </div>
                <div className={`text-2xl font-bold ${RAG_TEXT[m.rag]}`}>{m.value}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{m.sub}</div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Annual activity calendar                                      */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader
          icon={Calendar}
          title="Annual Activity Schedule"
          subtitle="The G3Q Gantt — what is due, in flight, on track or overdue across the AQMP"
          right={
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> done</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> on track</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> at risk</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> overdue</span>
            </div>
          }
        />
        <Card className="p-0 overflow-x-auto">
          <div className="grid grid-cols-12 min-w-[960px]">
            {GANTT_MONTHS.map((m) => (
              <div key={m.month} className="border-r border-slate-100 last:border-r-0">
                <div className="px-2 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-700 text-center">
                  {m.month}
                </div>
                <div className="p-2 space-y-1">
                  {m.activities.map((a) => {
                    const dot =
                      a.status === 'done' ? 'bg-emerald-500' :
                      a.status === 'on-track' ? 'bg-blue-500' :
                      a.status === 'at-risk' ? 'bg-amber-500' :
                      'bg-rose-500';
                    return (
                      <div key={a.name} className="flex items-start gap-1.5 text-[10px]">
                        <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
                        <span className="text-slate-600 leading-tight">{a.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* ISQM1 readiness                                               */}
      {/* ------------------------------------------------------------ */}
      <section>
        <SectionHeader
          icon={Target}
          title="ISQM(UK)1 Readiness"
          subtitle="Year-round evidence captured against each quality objective — Oct–Sep period, Dec reporting"
        />
        <Card>
          <div className="space-y-3">
            {ISQM1_OBJECTIVES.map((o) => (
              <div key={o.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{o.name}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${RAG_PILL[o.rag]}`}>
                    {o.evidence}% evidenced
                  </span>
                </div>
                <ProgressBar pct={o.evidence} rag={o.rag} />
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Footer note                                                   */}
      {/* ------------------------------------------------------------ */}
      <p className="text-[11px] text-slate-400 text-center pt-4 border-t border-slate-100">
        Figures shown are illustrative scaffolding — wire each panel to its source (file-review records, RCA log, training LMS,
        timesheets, ISQM1 evidence repository) in a follow-up implementation pass.
      </p>
    </div>
  );
}
