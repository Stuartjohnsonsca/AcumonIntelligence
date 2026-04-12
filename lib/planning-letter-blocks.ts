/**
 * Block renderers for the Planning Letter template.
 *
 * Each helper returns an HTML table string that matches the contract expected by
 * lib/template-pdf.ts — <table><colgroup><col width="N"></colgroup><thead><tr><th>
 * …</th></tr></thead><tbody><tr><td>…</td></tr></tbody></table>, with <br> inside
 * <td> for intra-cell paragraphs.
 */
import { prisma } from '@/lib/db';

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(s: any): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toBullets(items: string[]): string {
  return items.map(item => `• ${escapeHtml(item)}`).join('<br>');
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function emptyTable(header: string[], message: string): string {
  const cols = header.map(() => `<col width="${Math.floor(100 / header.length)}">`).join('');
  const headCells = header.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  return `<table><colgroup>${cols}</colgroup><thead><tr>${headCells}</tr></thead><tbody><tr><td colspan="${header.length}"><em>${escapeHtml(message)}</em></td></tr></tbody></table>`;
}

// ─── 1. Engagement team ────────────────────────────────────────────────────

export async function renderEngagementTeamTable(engagementId: string): Promise<string> {
  const members = await prisma.auditTeamMember.findMany({
    where: { engagementId },
    include: { user: { select: { name: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  const ROLE_LABEL: Record<string, string> = {
    RI: 'Responsible individual',
    Partner: 'Audit Partner',
    Manager: 'Audit Manager',
    Junior: 'Audit Junior',
  };

  if (members.length === 0) {
    return emptyTable(['Name', 'Role'], 'No team members assigned yet.');
  }

  const rows = members
    .map(m => {
      const name = m.user?.name || '';
      const role = ROLE_LABEL[m.role] || m.role;
      return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(role)}</td></tr>`;
    })
    .join('');

  return `<table><colgroup><col width="50"><col width="50"></colgroup><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ─── 2. Timetable ──────────────────────────────────────────────────────────

export async function renderTimetableTable(engagementId: string): Promise<string> {
  const dates = await prisma.auditAgreedDate.findMany({
    where: { engagementId },
    orderBy: { sortOrder: 'asc' },
  });

  const rows = dates
    .filter(d => d.description && d.targetDate)
    .map(d => `<tr><td>${escapeHtml(d.description)}</td><td>${escapeHtml(fmtDate(d.revisedTarget || d.targetDate))}</td></tr>`)
    .join('');

  if (!rows) {
    return emptyTable(['Key milestone agreed with management', 'Timelines'], 'No timetable milestones agreed yet.');
  }

  return `<table><colgroup><col width="60"><col width="40"></colgroup><thead><tr><th>Key milestone agreed with management</th><th>Timelines</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ─── 3. Ethics — non-audit services safeguards ─────────────────────────────

/**
 * Human-readable labels for the non-audit services stored in AuditEthics.data.
 * Keys match those used in the ethics form (e.g. `nas_prep_accounts_comment`).
 */
const NAS_LABELS: Record<string, string> = {
  nas_prep_accounts: 'Preparation of Financial Statements',
  nas_corp_tax: 'Preparation of Corporation Tax returns',
  nas_advisory: 'Advisory / Valuation services',
  nas_internal_audit: 'Internal audit services',
  nas_other_assurance: 'Other assurance services',
  nas_payroll: 'Payroll services',
  nas_vat_bookkeeping: 'VAT / bookkeeping services',
  nas_recruitment_legal_it: 'Recruitment / legal / IT services',
  nas_director_verification: 'Director verification services',
};

export async function renderEthicsSafeguardsTable(engagementId: string): Promise<string> {
  const ethics = await prisma.auditEthics.findUnique({ where: { engagementId } });
  const data = (ethics?.data as Record<string, any>) || {};

  const rows: string[] = [];
  for (const [key, label] of Object.entries(NAS_LABELS)) {
    const issue = data[`${key}_issue`];
    const safeguard = data[`${key}_safeguard`];
    // Include if the user has flagged this service (yes) OR has filled in a safeguard
    const flagged = issue === true || issue === 'yes' || issue === 'Yes' || (typeof safeguard === 'string' && safeguard.trim().length > 0);
    if (!flagged) continue;
    rows.push(`<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(safeguard || '')}</td></tr>`);
  }

  if (rows.length === 0) {
    return `<p><em>We have not identified any non-audit services that present a threat to our independence or objectivity.</em></p>`;
  }

  return `<table><colgroup><col width="45"><col width="55"></colgroup><thead><tr><th>Non-Audit Services Threat to Objectivity and Independence</th><th>Safeguard Implemented</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// ─── 4. Significant risks / Areas of focus ────────────────────────────────

export type AuditPlanDetail = 'high' | 'detailed';

interface RiskRowWithTests {
  lineItem: string;
  riskIdentified: string | null;
  assertions: string[];
  relatedTests: Array<{ name: string; description: string | null; assertions: string[] }>;
}

/**
 * Find the set of MethodologyTest records related to a risk row — matched by
 * overlapping assertions (ISA 315), firm-scoped and not flagged as data-collection.
 */
async function loadRisksWithRelatedTests(
  engagementId: string,
  category: 'significant_risk' | 'area_of_focus',
): Promise<RiskRowWithTests[]> {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return [];

  const rows = await prisma.auditRMMRow.findMany({
    where: { engagementId, rowCategory: category, isHidden: false },
    orderBy: { sortOrder: 'asc' },
  });

  if (rows.length === 0) return [];

  // Load all firm tests once and match in-memory (cheaper than N queries)
  const tests = await prisma.methodologyTest.findMany({
    where: { firmId: engagement.firmId, isActive: true, isIngest: false },
    select: { id: true, name: true, description: true, assertions: true },
  });

  function normaliseAssertions(x: any): string[] {
    if (Array.isArray(x)) return x.filter(Boolean).map(String);
    return [];
  }

  return rows.map(row => {
    const rowAssertions = normaliseAssertions(row.assertions);
    const related = tests
      .filter(t => {
        const tAssertions = normaliseAssertions(t.assertions);
        if (tAssertions.length === 0 || rowAssertions.length === 0) return false;
        return tAssertions.some(a => rowAssertions.includes(a));
      })
      .map(t => ({
        name: t.name,
        description: t.description,
        assertions: normaliseAssertions(t.assertions),
      }));

    return {
      lineItem: row.lineItem || '',
      riskIdentified: row.riskIdentified || null,
      assertions: rowAssertions,
      relatedTests: related,
    };
  });
}

function renderRiskTable(
  headerCol1: string,
  risks: RiskRowWithTests[],
  detail: AuditPlanDetail,
  emptyMessage: string,
): string {
  if (risks.length === 0) {
    return emptyTable([headerCol1, 'Risk description', 'Proposed approach'], emptyMessage);
  }

  const rows = risks
    .map(risk => {
      const riskCell =
        `<strong>${escapeHtml(risk.lineItem)}</strong>` +
        (risk.assertions.length
          ? `<br><br>Key Assertions:<br>${escapeHtml(risk.assertions.join(', '))}`
          : '');
      const descCell = escapeHtml(risk.riskIdentified || '—').replace(/\n/g, '<br>');

      let approachCell: string;
      if (risk.relatedTests.length === 0) {
        approachCell = '<em>No procedures linked to this risk yet.</em>';
      } else if (detail === 'high') {
        approachCell =
          'We plan to perform the following procedures:<br>' + toBullets(risk.relatedTests.map(t => t.name));
      } else {
        // Detailed view: name + description + assertions
        approachCell = risk.relatedTests
          .map(t => {
            const desc = t.description ? `<br>${escapeHtml(t.description).replace(/\n/g, '<br>')}` : '';
            const asserts = t.assertions.length ? `<br><em>Assertions: ${escapeHtml(t.assertions.join(', '))}</em>` : '';
            return `<strong>${escapeHtml(t.name)}</strong>${desc}${asserts}`;
          })
          .join('<br><br>');
      }

      return `<tr><td>${riskCell}</td><td>${descCell}</td><td>${approachCell}</td></tr>`;
    })
    .join('');

  return `<table><colgroup><col width="22"><col width="38"><col width="40"></colgroup><thead><tr><th>${escapeHtml(headerCol1)}</th><th>Risk description</th><th>Proposed approach</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export async function renderSignificantRisksTable(engagementId: string, detail: AuditPlanDetail): Promise<string> {
  const risks = await loadRisksWithRelatedTests(engagementId, 'significant_risk');
  return renderRiskTable('Significant risk', risks, detail, 'No significant risks have been tagged on RMM rows.');
}

export async function renderAreasOfFocusTable(engagementId: string, detail: AuditPlanDetail): Promise<string> {
  const risks = await loadRisksWithRelatedTests(engagementId, 'area_of_focus');
  return renderRiskTable('Area of focus', risks, detail, 'No areas of focus have been tagged on RMM rows.');
}
