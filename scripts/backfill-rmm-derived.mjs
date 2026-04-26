/**
 * One-shot backfill: derive and persist `finalRiskAssessment`,
 * `overallRisk` and `rowCategory` on every audit_rmm_row whose
 * Likelihood + Magnitude are set but those derived fields are missing.
 *
 * Pre-existing rows on the johnsons engagement got into this state
 * because the RMMTab auto-derive useEffect was reading r.overallRisk
 * (always null on saved rows — overallRisk was only computed in
 * computedRows for display) and never writing it back. The code fix
 * in this same change set means newly-edited rows save the derivation
 * automatically; this script is a one-shot to repair existing rows.
 *
 * Idempotent — only writes when the derived value differs from what's
 * already stored.
 *
 * Usage:
 *   node scripts/backfill-rmm-derived.mjs               # all firms
 *   node scripts/backfill-rmm-derived.mjs <engagementId>  # one engagement
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['error'] });

// Mirror lib/risk-table-lookup.ts (post-e183a54) so the script's
// derivation matches the runtime exactly.
const INHERENT = {
  'Remote':      { 'Remote': 'Remote', 'Low': 'Remote', 'Medium': 'Low',    'High': 'Low',    'Very High': 'Low' },
  'Unlikely':    { 'Remote': 'Remote', 'Low': 'Low',    'Medium': 'Low',    'High': 'Medium', 'Very High': 'High' },
  'Neutral':     { 'Remote': 'Low',    'Low': 'Low',    'Medium': 'Medium', 'High': 'High',   'Very High': 'High' },
  'Likely':      { 'Remote': 'Low',    'Low': 'Medium', 'Medium': 'High',   'High': 'Very High', 'Very High': 'Very High' },
  'Very Likely': { 'Remote': 'Low',    'Low': 'High',   'Medium': 'High',   'High': 'Very High', 'Very High': 'Very High' },
};
const CONTROL = {
  'Remote':    { 'Not Tested': 'Remote', 'Effective': 'Remote', 'Partially Effective': 'Low',    'Not Effective': 'Low' },
  'Low':       { 'Not Tested': 'Low',    'Effective': 'Low',    'Partially Effective': 'Low',    'Not Effective': 'Medium' },
  'Medium':    { 'Not Tested': 'Medium', 'Effective': 'Low',    'Partially Effective': 'Medium', 'Not Effective': 'High' },
  'High':      { 'Not Tested': 'High',   'Effective': 'Medium', 'Partially Effective': 'High',   'Not Effective': 'High' },
  'Very High': { 'Not Tested': 'Very High', 'Effective': 'High', 'Partially Effective': 'Very High', 'Not Effective': 'Very High' },
};

const filterEngagementId = process.argv[2] || null;

try {
  // Load every firm's riskClassification so the per-row classification
  // reflects how each firm has configured the table.
  const firmTables = await prisma.methodologyRiskTable.findMany({ where: { tableType: 'riskClassification' } });
  const classMapByFirm = {};
  for (const t of firmTables) classMapByFirm[t.firmId] = t.data || {};

  const rows = await prisma.auditRMMRow.findMany({
    where: filterEngagementId ? { engagementId: filterEngagementId } : {},
    include: { engagement: { select: { firmId: true } } },
  });

  let updated = 0;
  let skipped = 0;
  let alreadyOk = 0;

  for (const r of rows) {
    if (!r.likelihood || !r.magnitude || r.relevance === 'N') { skipped++; continue; }

    const inherent = INHERENT[r.likelihood]?.[r.magnitude] ?? null;
    const ctrl = r.controlRisk || 'Not Tested';
    const overall = inherent ? CONTROL[inherent]?.[ctrl] ?? null : null;
    const classMap = classMapByFirm[r.engagement.firmId] || {};
    const classification = overall
      ? (classMap[overall] || (overall === 'High' || overall === 'Very High' ? 'Significant Risk' : overall === 'Medium' ? 'Area of Focus' : null))
      : null;
    const rowCategory = classification === 'Significant Risk' ? 'significant_risk'
      : classification === 'Area of Focus' ? 'area_of_focus'
      : null;

    const needsUpdate =
      (r.finalRiskAssessment || null) !== (inherent || null)
      || (r.overallRisk || null) !== (overall || null)
      || (r.rowCategory || null) !== (rowCategory || null);

    if (!needsUpdate) { alreadyOk++; continue; }

    await prisma.auditRMMRow.update({
      where: { id: r.id },
      data: { finalRiskAssessment: inherent, overallRisk: overall, rowCategory },
    });
    updated++;
    console.log(`  Updated row ${r.id}: L=${r.likelihood} M=${r.magnitude} C=${ctrl} → inh=${inherent} overall=${overall} cat=${rowCategory}`);
  }

  console.log(`\nDone. updated=${updated}  alreadyOk=${alreadyOk}  skipped(no L/M)=${skipped}  total=${rows.length}`);
} finally { await prisma.$disconnect(); }
