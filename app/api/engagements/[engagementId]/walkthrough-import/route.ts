import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import ExcelJS from 'exceljs';

// Matrix schema (kept in sync with the client)
export interface PhaseCell { description: string; control: string; frequency: string; evidence: string; }
export interface MatrixStep {
  id: string;
  label: string;
  controlWeakness?: string;
  evidenceScreenshots?: string;
  phases: { initiation: PhaseCell; process: PhaseCell; recording: PhaseCell; reporting: PhaseCell };
}
export interface WalkthroughMatrix {
  header: {
    auditPeriod?: string;
    processTitle?: string;
    walkthroughDate?: string;
    attendees?: string;
    processOwner?: string;
    itSystems?: string;
    approvalLimits?: { amount: string; approver: string }[];
    note?: string;
  };
  conclusions: { designAndImplementation?: string; planToTestControls?: string; substantiveImpact?: string };
  steps: MatrixStep[];
  importedAt?: string;
  sourceFileName?: string;
}

const PHASE_COL = { initiation: 2, process: 4, recording: 6, reporting: 8 } as const;
const WEAKNESS_COL = 9;
const SCREENSHOT_COL = 11;

const FIXED_SUB_LABELS = [
  'identified control & related assertion',
  'identified control and related assertion',
  'frequency of control',
  'walkthrough evidence',
];

function cellStr(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = ws.getCell(row, col).value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if (Array.isArray(obj.richText)) return (obj.richText as Array<{ text?: string }>).map(r => r.text ?? '').join('').trim();
    if (typeof obj.result === 'string' || typeof obj.result === 'number') return String(obj.result).trim();
    if (typeof obj.formula === 'string') return '';
  }
  return String(v).trim();
}

function findHeaderRow(ws: ExcelJS.Worksheet): number | null {
  const last = Math.min(ws.rowCount, 100);
  for (let r = 1; r <= last; r++) {
    const b = cellStr(ws, r, PHASE_COL.initiation).toLowerCase();
    const d = cellStr(ws, r, PHASE_COL.process).toLowerCase();
    const f = cellStr(ws, r, PHASE_COL.recording).toLowerCase();
    const h = cellStr(ws, r, PHASE_COL.reporting).toLowerCase();
    if (b === 'initiation' && d === 'process' && f === 'recording' && h === 'reporting') return r;
  }
  return null;
}

function parseHeader(ws: ExcelJS.Worksheet): WalkthroughMatrix['header'] {
  const header: WalkthroughMatrix['header'] = {};
  const auditPeriod = cellStr(ws, 2, 1);
  if (auditPeriod && /year|period|ended/i.test(auditPeriod)) header.auditPeriod = auditPeriod;
  const processTitle = cellStr(ws, 5, 1);
  if (processTitle) header.processTitle = processTitle;
  const note = cellStr(ws, 5, 6);
  if (note) header.note = note;

  // Metadata block — scan rows 6..16 for known labels in col A
  for (let r = 6; r <= 16; r++) {
    const label = cellStr(ws, r, 1).toLowerCase();
    const val = cellStr(ws, r, 2);
    if (!label || !val) continue;
    if (label.includes('walkthrough date')) header.walkthroughDate = val;
    else if (label.includes('meeting attendees')) header.attendees = val;
    else if (label.includes('process owner')) header.processOwner = val;
    else if (label.includes('it system')) header.itSystems = val;
  }

  // Invoice approval limits — scan rows 8..20 for a row with "Invoice amount" in col H
  let limitsStart = -1;
  for (let r = 6; r <= 20; r++) {
    const h = cellStr(ws, r, 8).toLowerCase();
    if (h.includes('invoice amount')) { limitsStart = r + 1; break; }
  }
  if (limitsStart > 0) {
    const limits: { amount: string; approver: string }[] = [];
    for (let r = limitsStart; r <= limitsStart + 10; r++) {
      const amount = cellStr(ws, r, 8);
      const approver = cellStr(ws, r, 9);
      if (!amount && !approver) break;
      limits.push({ amount, approver });
    }
    if (limits.length) header.approvalLimits = limits;
  }
  return header;
}

function parseConclusions(ws: ExcelJS.Worksheet): WalkthroughMatrix['conclusions'] {
  const out: WalkthroughMatrix['conclusions'] = {};
  // Find "Conclusions" heading row, then read 3 rows below
  let conclusionsRow = -1;
  for (let r = 1; r <= 30; r++) {
    if (cellStr(ws, r, 1).toLowerCase() === 'conclusions') { conclusionsRow = r; break; }
  }
  if (conclusionsRow < 0) return out;
  for (let r = conclusionsRow + 1; r <= conclusionsRow + 6; r++) {
    const label = cellStr(ws, r, 1).toLowerCase();
    const val = cellStr(ws, r, 2);
    if (!label) continue;
    if (label.includes('design and implementation')) out.designAndImplementation = val;
    else if (label.includes('plan to test controls')) out.planToTestControls = val;
    else if (label.includes('substantive procedures') || label.includes('impact')) out.substantiveImpact = val;
  }
  return out;
}

function emptyCell(): PhaseCell { return { description: '', control: '', frequency: '', evidence: '' }; }
function emptyStep(label = ''): MatrixStep {
  return {
    id: Math.random().toString(36).slice(2, 10),
    label,
    phases: { initiation: emptyCell(), process: emptyCell(), recording: emptyCell(), reporting: emptyCell() },
  };
}

function parseSteps(ws: ExcelJS.Worksheet, headerRow: number): MatrixStep[] {
  const steps: MatrixStep[] = [];
  let r = headerRow + 1;
  const last = ws.rowCount;

  while (r <= last) {
    const label = cellStr(ws, r, 1);
    if (!label) { r++; continue; }
    if (FIXED_SUB_LABELS.includes(label.toLowerCase())) { r++; continue; } // stray sub-row, skip

    // This is a step-starting row — col A is the step name.
    const step = emptyStep(label);

    // Row r — descriptions for each phase, plus weakness + screenshots
    step.phases.initiation.description = cellStr(ws, r, PHASE_COL.initiation);
    step.phases.process.description = cellStr(ws, r, PHASE_COL.process);
    step.phases.recording.description = cellStr(ws, r, PHASE_COL.recording);
    step.phases.reporting.description = cellStr(ws, r, PHASE_COL.reporting);
    const weakness = cellStr(ws, r, WEAKNESS_COL);
    if (weakness) step.controlWeakness = weakness;
    const screenshots = cellStr(ws, r, SCREENSHOT_COL);
    if (screenshots) step.evidenceScreenshots = screenshots;

    // Look ahead up to 5 rows for the three fixed sub-rows
    let cursor = r + 1;
    let matched = 0;
    while (cursor <= last && matched < 3 && cursor - r <= 5) {
      const subLabel = cellStr(ws, cursor, 1).toLowerCase();
      if (!subLabel) { cursor++; continue; }

      if (subLabel.includes('identified control')) {
        step.phases.initiation.control = cellStr(ws, cursor, PHASE_COL.initiation);
        step.phases.process.control = cellStr(ws, cursor, PHASE_COL.process);
        step.phases.recording.control = cellStr(ws, cursor, PHASE_COL.recording);
        step.phases.reporting.control = cellStr(ws, cursor, PHASE_COL.reporting);
        matched++;
      } else if (subLabel.includes('frequency of control')) {
        step.phases.initiation.frequency = cellStr(ws, cursor, PHASE_COL.initiation);
        step.phases.process.frequency = cellStr(ws, cursor, PHASE_COL.process);
        step.phases.recording.frequency = cellStr(ws, cursor, PHASE_COL.recording);
        step.phases.reporting.frequency = cellStr(ws, cursor, PHASE_COL.reporting);
        matched++;
      } else if (subLabel.includes('walkthrough evidence')) {
        step.phases.initiation.evidence = cellStr(ws, cursor, PHASE_COL.initiation);
        step.phases.process.evidence = cellStr(ws, cursor, PHASE_COL.process);
        step.phases.recording.evidence = cellStr(ws, cursor, PHASE_COL.recording);
        step.phases.reporting.evidence = cellStr(ws, cursor, PHASE_COL.reporting);
        matched++;
      } else {
        // Hit a new step label before matching all 3 — stop here; outer loop will handle.
        break;
      }
      cursor++;
    }

    steps.push(step);
    r = cursor;
  }

  return steps;
}

function buildNarrative(matrix: WalkthroughMatrix): string {
  const lines: string[] = [];
  if (matrix.header.processTitle) lines.push(`# ${matrix.header.processTitle}`);
  if (matrix.header.processOwner) lines.push(`Process owner: ${matrix.header.processOwner}`);
  if (matrix.header.itSystems) lines.push(`IT systems: ${matrix.header.itSystems}`);
  if (lines.length) lines.push('');
  const phaseNames: Array<keyof MatrixStep['phases']> = ['initiation', 'process', 'recording', 'reporting'];
  const phaseLabels = { initiation: 'Initiation', process: 'Process', recording: 'Recording', reporting: 'Reporting' };
  for (const step of matrix.steps) {
    lines.push(`## ${step.label}`);
    for (const p of phaseNames) {
      const cell = step.phases[p];
      const desc = cell.description?.trim();
      if (desc && desc.toLowerCase() !== 'n/a' && desc.toLowerCase() !== 'n.a') {
        lines.push(`**${phaseLabels[p]}:** ${desc}`);
      }
    }
    if (step.controlWeakness && !/none|n\/a|n\.a/i.test(step.controlWeakness)) {
      lines.push(`_Control weakness / ML point:_ ${step.controlWeakness}`);
    }
    lines.push('');
  }
  if (matrix.conclusions.designAndImplementation) {
    lines.push('## Conclusions');
    lines.push(`**Design & Implementation:** ${matrix.conclusions.designAndImplementation}`);
    if (matrix.conclusions.planToTestControls) lines.push(`**Plan to test controls:** ${matrix.conclusions.planToTestControls}`);
    if (matrix.conclusions.substantiveImpact) lines.push(`**Impact on substantive procedures:** ${matrix.conclusions.substantiveImpact}`);
  }
  return lines.join('\n');
}

interface ControlRow { description: string; type: string; frequency: string; tested: boolean }

function buildControls(matrix: WalkthroughMatrix): ControlRow[] {
  const controls: ControlRow[] = [];
  const phaseLabels = { initiation: 'Initiation', process: 'Process', recording: 'Recording', reporting: 'Reporting' };
  const phaseNames: Array<keyof MatrixStep['phases']> = ['initiation', 'process', 'recording', 'reporting'];
  for (const step of matrix.steps) {
    for (const p of phaseNames) {
      const cell = step.phases[p];
      const ctrl = cell.control?.trim();
      if (!ctrl) continue;
      if (/^(no control|n\/a|n\.a\.?|none)$/i.test(ctrl)) continue;
      controls.push({
        description: `${step.label} — ${phaseLabels[p]}: ${ctrl}`,
        type: 'Manual',
        frequency: cell.frequency?.trim() || 'Per transaction',
        tested: false,
      });
    }
  }
  return controls;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const sheetName = (form.get('sheetName') as string | null) || undefined;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: 'Could not read Excel file' }, { status: 400 });
  }

  const sheets = wb.worksheets.map((w) => w.name);
  let ws: ExcelJS.Worksheet | undefined;
  if (sheetName) ws = wb.getWorksheet(sheetName);
  if (!ws) ws = wb.worksheets.find((w) => /walkthrough/i.test(w.name)) || wb.getWorksheet(1);
  if (!ws) return NextResponse.json({ error: 'No worksheet found' }, { status: 400 });

  const headerRow = findHeaderRow(ws);
  if (headerRow == null) {
    return NextResponse.json({
      error: 'Could not find the process matrix header. Expected a row with "Initiation / Process / Recording / Reporting" across columns B, D, F, H.',
      sheets,
    }, { status: 400 });
  }

  const matrix: WalkthroughMatrix = {
    header: parseHeader(ws),
    conclusions: parseConclusions(ws),
    steps: parseSteps(ws, headerRow),
    importedAt: new Date().toISOString(),
    sourceFileName: file.name,
  };

  const narrative = buildNarrative(matrix);
  const controls = buildControls(matrix);

  return NextResponse.json({ matrix, narrative, controls, sheets, sheetUsed: ws.name });
}
