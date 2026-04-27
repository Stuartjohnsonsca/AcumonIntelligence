import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin } from '../_auth';

/**
 * Seed the standard G3Q operational-model defaults — CSFs, annual activity
 * schedule and ISQM(UK)1 objectives — taken directly from Acumon's G3Q
 * Operational Model deck. Idempotent: skips rows that already exist for
 * the firm, so you can run this against a partially-populated dashboard
 * without overwriting custom entries.
 */

// ─── CSFs from slides 6, 8, 9, 11, 12, 13, 15, 18, 20 ─────────────────
const G3Q_CSFS: { pillar: string; subComponent: string; name: string; targetMetric?: string }[] = [
  // Goodwill — Branding (slide 6)
  { pillar: 'goodwill', subComponent: 'Branding', name: 'Expanding presence in global markets', targetMetric: 'Multi-jurisdiction presence' },
  { pillar: 'goodwill', subComponent: 'Branding', name: 'Publications as experts on industry matters', targetMetric: 'Quarterly publications' },
  { pillar: 'goodwill', subComponent: 'Branding', name: "Meeting client's CSF on service delivery", targetMetric: 'May/Oct review' },
  // Goodwill — Industry (slide 8)
  { pillar: 'goodwill', subComponent: 'Industry', name: "Building regulator trust on the firm's capacity and capabilities", targetMetric: 'Mar/Sep review' },
  { pillar: 'goodwill', subComponent: 'Industry', name: 'Generating revenue from other firms (technical/cold/hot file reviews)', targetMetric: 'Jun/Nov KPI review' },
  { pillar: 'goodwill', subComponent: 'Industry', name: 'Strong recruiter relationships supporting dynamic resourcing', targetMetric: 'Quarterly catch-ups' },
  // Goodwill — People (slide 9)
  { pillar: 'goodwill', subComponent: 'People', name: 'Improvement in overall training effectiveness', targetMetric: 'Jan/Jul review' },
  { pillar: 'goodwill', subComponent: 'People', name: 'Staff utilisation in line with industry standards', targetMetric: '75–80% quarterly' },
  { pillar: 'goodwill', subComponent: 'People', name: 'Culture surveys reflect leadership focus on audit quality', targetMetric: 'Annual survey Jul' },
  { pillar: 'goodwill', subComponent: 'People', name: 'High performers rewarded; performance plans for those needing improvement', targetMetric: 'Aug/Feb performance reviews' },
  // Governance — Leadership (slide 11)
  { pillar: 'governance', subComponent: 'Leadership', name: 'Staff understand firm leadership prioritises quality', targetMetric: 'Survey-evidenced' },
  { pillar: 'governance', subComponent: 'Leadership', name: 'File quality ratings show year-on-year improvement', targetMetric: 'Annual review' },
  { pillar: 'governance', subComponent: 'Leadership', name: 'Roles, responsibilities & accountability framework operating', targetMetric: 'Dec governance review' },
  { pillar: 'governance', subComponent: 'Leadership', name: 'Continuous improvement in accountability metrics', targetMetric: 'Aug/Feb performance' },
  // Governance — Risks (slide 12)
  { pillar: 'governance', subComponent: 'Risks', name: 'Detailed risk assessment for new + continuing clients', targetMetric: 'Jul/Nov risk review' },
  { pillar: 'governance', subComponent: 'Risks', name: 'Firmwide + ISQM1 risk matrix accounts for all material risks', targetMetric: 'Jul/Nov review' },
  { pillar: 'governance', subComponent: 'Risks', name: 'No breaches of ethical standards', targetMetric: '0 breaches; May/Nov review' },
  { pillar: 'governance', subComponent: 'Risks', name: 'On-time reporting to FRC & RSB under Audit regulations', targetMetric: '100% on-time; Jan/Jul' },
  // Governance — Digitally led (slide 13)
  { pillar: 'governance', subComponent: 'Digitally led', name: 'Effective integration of PM system + quality functions', targetMetric: 'Quarterly PM integration' },
  { pillar: 'governance', subComponent: 'Digitally led', name: 'Granular MIS / reporting available for decision making', targetMetric: 'Apr/Oct MIS review' },
  { pillar: 'governance', subComponent: 'Digitally led', name: 'Staff adaptable to data-driven mindset', targetMetric: 'Jul staff survey' },
  { pillar: 'governance', subComponent: 'Digitally led', name: 'Firmwide compliance with data-security protocols', targetMetric: 'Oct review' },
  // Growth — Market proposition (slide 15)
  { pillar: 'growth', subComponent: 'Market proposition', name: 'Entry into new sectors and geographies', targetMetric: 'Dec sector & geographies review' },
  { pillar: 'growth', subComponent: 'Market proposition', name: 'Methodology readiness prior to accepting target-sector audits', targetMetric: 'Quarterly methodology review' },
  { pillar: 'growth', subComponent: 'Market proposition', name: 'Resourcing assessment supports growth plan', targetMetric: 'Quarterly capacity review' },
  // Growth — Capabilities (slide 18)
  { pillar: 'growth', subComponent: 'Capabilities', name: 'Framework for assessing candidates against growth targets', targetMetric: 'Annual review Jan' },
  { pillar: 'growth', subComponent: 'Capabilities', name: 'Improvement in overall training effectiveness', targetMetric: 'Jan/Jul' },
  { pillar: 'growth', subComponent: 'Capabilities', name: 'Effective integration of AI tools into service delivery', targetMetric: 'Dec/Jan AI tools review' },
  { pillar: 'growth', subComponent: 'Capabilities', name: 'Decreasing year-on-year employee attrition', targetMetric: '<12% (Feb review)' },
  { pillar: 'growth', subComponent: 'Capabilities', name: 'Ability to draw on alliance partners / consultants', targetMetric: 'Active partnerships' },
  // Growth — Commercials (slide 20)
  { pillar: 'growth', subComponent: 'Commercials', name: 'Average revenue per hour meets firm thresholds', targetMetric: 'Jan commercial fees review' },
  { pillar: 'growth', subComponent: 'Commercials', name: 'Major wins of large and SME clients', targetMetric: 'Quarterly tracking' },
  { pillar: 'growth', subComponent: 'Commercials', name: 'Minimising unbilled WIP', targetMetric: 'Monthly review' },
  { pillar: 'growth', subComponent: 'Commercials', name: 'Monetisation rate', targetMetric: 'Mar KPI review' },
  // Quality — Monitoring (slide 21)
  { pillar: 'quality', subComponent: 'Monitoring', name: 'Annual monitoring plan executed on schedule', targetMetric: '90%+ YTD complete' },
  { pillar: 'quality', subComponent: 'Monitoring', name: 'Cold + hot file reviews per RI/manager', targetMetric: '3 per RI/manager annually' },
  { pillar: 'quality', subComponent: 'Monitoring', name: 'EQR process review effective', targetMetric: 'Annual EQR review' },
  // Quality — RCA
  { pillar: 'quality', subComponent: 'Root Cause Analysis', name: 'RCA completed within 1 month of monitoring activity', targetMetric: '100% within 30 days' },
  { pillar: 'quality', subComponent: 'Root Cause Analysis', name: 'Root causes mapped to process / methodology / supervision / data / resourcing', targetMetric: 'All findings categorised' },
  // Quality — Remediation
  { pillar: 'quality', subComponent: 'Remediation', name: 'Half-yearly effectiveness reporting (Jul/Jan)', targetMetric: '95% remediations re-tested as effective' },
  { pillar: 'quality', subComponent: 'Remediation', name: 'Remediation plan agreed with ACP and Management Board', targetMetric: 'All issues with action plan' },
];

// ─── Annual activity schedule from slide 22 Gantt ─────────────────────
const G3Q_SCHEDULE: { monthIndex: number; activityName: string }[] = [
  // January
  { monthIndex: 0, activityName: 'Training effectiveness review' },
  { monthIndex: 0, activityName: 'Staff training plan' },
  { monthIndex: 0, activityName: 'Capabilities review' },
  { monthIndex: 0, activityName: 'AI Tools effectiveness' },
  { monthIndex: 0, activityName: 'Commercial fees review' },
  { monthIndex: 0, activityName: 'AQT audit file reviews' },
  { monthIndex: 0, activityName: 'ICAEW & FRC Annual Return' },
  // February
  { monthIndex: 1, activityName: 'Performance reviews' },
  { monthIndex: 1, activityName: 'Methodologies review' },
  { monthIndex: 1, activityName: 'Attrition review' },
  { monthIndex: 1, activityName: 'Career paths review' },
  { monthIndex: 1, activityName: 'Reassess scoping of technical team' },
  { monthIndex: 1, activityName: 'G3Q model & effectiveness review' },
  // March
  { monthIndex: 2, activityName: 'Publications progress (Q1)' },
  { monthIndex: 2, activityName: 'Regulatory review' },
  { monthIndex: 2, activityName: 'Staff utilisation review' },
  { monthIndex: 2, activityName: 'PM Integration check' },
  { monthIndex: 2, activityName: 'Capacity assessment' },
  { monthIndex: 2, activityName: 'Remuneration review' },
  { monthIndex: 2, activityName: "KPI's review (setting)" },
  { monthIndex: 2, activityName: 'AQT file selection review' },
  // April
  { monthIndex: 3, activityName: 'MIS System review' },
  { monthIndex: 3, activityName: 'Spot audit quality reviews' },
  { monthIndex: 3, activityName: 'ICAEW CC Annual Return' },
  { monthIndex: 3, activityName: 'Transparency Report' },
  // May
  { monthIndex: 4, activityName: "Client's CSF metrics" },
  { monthIndex: 4, activityName: 'Ethical review' },
  { monthIndex: 4, activityName: 'Methodologies review' },
  // June
  { monthIndex: 5, activityName: 'Publications progress (Q2)' },
  { monthIndex: 5, activityName: "KPI's review (other firms)" },
  { monthIndex: 5, activityName: 'Staff utilisation review' },
  { monthIndex: 5, activityName: 'PM Integration check' },
  { monthIndex: 5, activityName: 'Capacity assessment' },
  { monthIndex: 5, activityName: 'Remediation plan updates' },
  // July
  { monthIndex: 6, activityName: 'Training effectiveness review' },
  { monthIndex: 6, activityName: 'Staff culture surveys' },
  { monthIndex: 6, activityName: 'Risk review (firm, accept & continuance)' },
  { monthIndex: 6, activityName: 'Remediation effectiveness reporting (H1)' },
  // August
  { monthIndex: 7, activityName: 'Performance reviews' },
  { monthIndex: 7, activityName: 'Methodologies review' },
  { monthIndex: 7, activityName: 'Thematic reviews' },
  // September
  { monthIndex: 8, activityName: 'Publications progress (Q3)' },
  { monthIndex: 8, activityName: 'Staff utilisation review' },
  { monthIndex: 8, activityName: 'Capacity assessment' },
  { monthIndex: 8, activityName: 'Regulatory review' },
  // October
  { monthIndex: 9, activityName: "Client's CSF metrics" },
  { monthIndex: 9, activityName: 'MIS System review' },
  { monthIndex: 9, activityName: 'Data security review' },
  // November
  { monthIndex: 10, activityName: "KPI's review (other firms)" },
  { monthIndex: 10, activityName: 'Risk review (firm, accept & continuance)' },
  { monthIndex: 10, activityName: 'Ethical review' },
  { monthIndex: 10, activityName: 'Methodologies review' },
  { monthIndex: 10, activityName: 'Remediation plan updates' },
  // December
  { monthIndex: 11, activityName: 'Governance review' },
  { monthIndex: 11, activityName: 'Marketing strategy review' },
  { monthIndex: 11, activityName: 'Publications plan (next year)' },
  { monthIndex: 11, activityName: 'Staff utilisation review' },
  { monthIndex: 11, activityName: 'Sector & Geographies review' },
  { monthIndex: 11, activityName: 'Capacity assessment' },
  { monthIndex: 11, activityName: 'AI Tools effectiveness' },
  { monthIndex: 11, activityName: 'ISQM(UK)1 Annual Evaluation' },
];

// ─── ISQM(UK)1 quality objectives ─────────────────────────────────────
const ISQM_OBJECTIVES = [
  'governance_leadership',
  'ethics',
  'acceptance_continuance',
  'engagement_performance',
  'resources',
  'information_communication',
  'monitoring_remediation',
  'risk_assessment',
];

// ─── Pillar straplines ────────────────────────────────────────────────
const PILLAR_STRAPLINES: Record<string, string> = {
  goodwill: 'Reputation capital — branding, industry, people',
  governance: 'Tone, principles, risks and digital enablement',
  growth: 'Market proposition, capabilities and commercials',
  quality: 'Monitoring, RCA, remediation and ISQM(UK)1',
};

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const firmId = gate.session.user.firmId;

  const body = await req.json().catch(() => ({}));
  const targetYear = Number(body?.year) || new Date().getFullYear();
  const seedCsfs = body?.seedCsfs !== false;
  const seedSchedule = body?.seedSchedule !== false;
  const seedIsqm = body?.seedIsqm !== false;
  const seedPillars = body?.seedPillars !== false;

  const result = {
    csfsCreated: 0,
    csfsSkipped: 0,
    scheduleCreated: 0,
    scheduleSkipped: 0,
    isqmCreated: 0,
    isqmSkipped: 0,
    pillarsCreated: 0,
    pillarsSkipped: 0,
  };

  // CSFs — skip duplicates by (pillar, name)
  if (seedCsfs) {
    const existing = await prisma.perfCsf.findMany({
      where: { firmId },
      select: { pillar: true, name: true },
    });
    const have = new Set(existing.map(e => `${e.pillar}::${e.name}`));
    for (let i = 0; i < G3Q_CSFS.length; i++) {
      const csf = G3Q_CSFS[i];
      const key = `${csf.pillar}::${csf.name}`;
      if (have.has(key)) { result.csfsSkipped++; continue; }
      await prisma.perfCsf.create({
        data: {
          firmId,
          pillar: csf.pillar,
          subComponent: csf.subComponent,
          name: csf.name,
          targetMetric: csf.targetMetric || null,
          rag: 'grey',
          isActive: true,
          sortOrder: i,
        },
      });
      result.csfsCreated++;
    }
  }

  // Annual schedule for the target year — skip on unique conflict
  if (seedSchedule) {
    for (let i = 0; i < G3Q_SCHEDULE.length; i++) {
      const item = G3Q_SCHEDULE[i];
      try {
        await prisma.perfActivitySchedule.create({
          data: {
            firmId,
            year: targetYear,
            monthIndex: item.monthIndex,
            activityName: item.activityName,
            status: 'planned',
            sortOrder: i,
          },
        });
        result.scheduleCreated++;
      } catch {
        result.scheduleSkipped++;
      }
    }
  }

  // ISQM(UK)1 objectives — empty rows so the panel renders 8 lines
  if (seedIsqm) {
    for (const objective of ISQM_OBJECTIVES) {
      try {
        await prisma.perfIsqmEvidence.create({
          data: {
            firmId,
            objective,
            evidenceCount: 0,
            targetCount: 0,
            rag: 'grey',
            ragManual: false,
          },
        });
        result.isqmCreated++;
      } catch {
        result.isqmSkipped++;
      }
    }
  }

  // Pillar straplines — only create if absent (don't overwrite manual scores)
  if (seedPillars) {
    for (const pillar of Object.keys(PILLAR_STRAPLINES)) {
      try {
        await prisma.perfPillarScore.create({
          data: {
            firmId,
            pillar,
            strapline: PILLAR_STRAPLINES[pillar],
          },
        });
        result.pillarsCreated++;
      } catch {
        result.pillarsSkipped++;
      }
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
