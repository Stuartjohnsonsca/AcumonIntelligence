/**
 * Walkthrough Excel Importer
 * =================================================================
 * Parses the firm's pre-existing walkthrough template (xlsx) and
 * produces a FlowStep[] compatible with the WalkthroughFlowEditor
 * + header metadata (attendees, process owner, conclusions, etc.)
 * that the UI can prefill into the process's permanent-file section.
 *
 * Template shape (see Data Test/Copy of Kanova Revenue Process 2025.xlsx):
 *   Rows  0–12  : audit / process metadata + sign-off block
 *   Row   13    : column headers — Initiation | Process | Recording |
 *                 Reporting | Control weakness / ML Point |
 *                 Walkthrough Evidence
 *   Rows  14+   : repeating 4-row blocks per process section
 *                 row 0: section title in col A; stage content in
 *                        cols B, D, F, H; weakness in col I;
 *                        evidence in col K
 *                 row 1: "Identified control & Related Assertion"
 *                        with the assertion text per stage
 *                 row 2: "Frequency of control" per stage
 *                 row 3: "Walkthrough evidence" per stage
 *
 * The firm may refine their template over time (different sheet
 * names, slightly different labels), so we match row labels case-
 * insensitively and with a bit of keyword tolerance rather than
 * exact string equality.
 */

import * as XLSX from 'xlsx';

/** A single stage cell value (null when the cell is blank / N/A). */
type StageValue = string | null;

/** Ordered stage keys — also used as the column-to-key map when we
 *  reconstruct FlowStep labels. */
const STAGES = ['initiation', 'process', 'recording', 'reporting'] as const;
type StageKey = typeof STAGES[number];

/** Column indices in the data rows. The template uses empty spacer
 *  columns between the four stages to make the spreadsheet visually
 *  wider, so the stage columns aren't contiguous. */
const STAGE_COL: Record<StageKey, number> = {
  initiation: 1, // col B
  process:    3, // col D
  recording:  5, // col F
  reporting:  7, // col H
};
const WEAKNESS_COL = 8;  // col I
const EVIDENCE_COL = 10; // col K

export interface ParsedSection {
  /** Human-readable section name (e.g. "Customer invoicing"). */
  name: string;
  stages: Record<StageKey, StageValue>;
  /** "Identified control & Related Assertion" per stage. */
  control: Record<StageKey, StageValue>;
  /** "Frequency of control" per stage. */
  frequency: Record<StageKey, StageValue>;
  /** "Walkthrough evidence" per stage. */
  evidence: Record<StageKey, StageValue>;
  /** Top-level weakness + evidence (cols I / K on the first row). */
  weakness: StageValue;
  evidenceSummary: StageValue;
}

export interface ParsedWalkthrough {
  processName: string;
  auditYearEnded?: string;
  walkthroughDate?: string;
  attendees?: string;
  processOwner?: string;
  itSystems?: string;
  conclusions?: {
    designAndImplementation?: string;
    planToTestControls?: string;
    substantiveImpact?: string;
  };
  sections: ParsedSection[];
}

/** Trim + collapse whitespace, treat "N/A", "N.A", "-" as blanks. */
function cleanCell(v: unknown): StageValue {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  if (lc === 'n/a' || lc === 'n.a' || lc === 'n.a.' || lc === '-' || lc === 'none identified' || lc === 'none identfiied' || lc === 'none  identified') return null;
  return s;
}

/** Case-insensitive label test that tolerates the firm's various
 *  spelling drifts ("identfiied" etc.). */
function labelMatches(cell: string, needles: string[]): boolean {
  const lc = cell.toLowerCase();
  return needles.some(n => lc.includes(n.toLowerCase()));
}

/** Parse an uploaded .xlsx buffer into a normalised walkthrough
 *  structure. Never throws on malformed rows — returns whatever it
 *  can recover so the UI can still present a partial import. */
export function parseWalkthroughXlsx(buffer: Buffer | ArrayBuffer | Uint8Array): ParsedWalkthrough {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Uploaded workbook is empty.');
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });

  // ─── Metadata block (rows 0–12) ───────────────────────────────
  // The exact row indexes can drift across firm templates, so we
  // scan for labels rather than hard-coding positions.
  const meta: Partial<ParsedWalkthrough> = { conclusions: {} };
  let dataStartRow = 13;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i];
    const labelA = cleanCell(r[0]) || '';
    const valB = cleanCell(r[1]);
    const valBOrE = valB ?? cleanCell(r[4]);
    if (labelMatches(labelA, ['audit for the year ended'])) {
      meta.auditYearEnded = labelA;
    } else if (labelMatches(labelA, ['walkthrough date'])) {
      meta.walkthroughDate = valB ? excelDateToIso(valB) : undefined;
    } else if (labelMatches(labelA, ['meeting attendees', 'attendees'])) {
      meta.attendees = valB ?? undefined;
    } else if (labelMatches(labelA, ['process owner'])) {
      meta.processOwner = valB ?? undefined;
    } else if (labelMatches(labelA, ['it systems'])) {
      meta.itSystems = valB ?? undefined;
    } else if (labelMatches(labelA, ['design and implementation'])) {
      meta.conclusions!.designAndImplementation = valBOrE ?? undefined;
    } else if (labelMatches(labelA, ['plan to test controls'])) {
      meta.conclusions!.planToTestControls = valBOrE ?? undefined;
    } else if (labelMatches(labelA, ['substantive procedures'])) {
      meta.conclusions!.substantiveImpact = valBOrE ?? undefined;
    }
    // The stage-header row tells us where the process table starts.
    const maybeInitiation = cleanCell(r[1]);
    const maybeRecording  = cleanCell(r[5]);
    if (maybeInitiation && maybeRecording &&
        maybeInitiation.toLowerCase().includes('initiation') &&
        maybeRecording.toLowerCase().includes('recording')) {
      dataStartRow = i + 1;
    }
  }

  // ─── Process sections ─────────────────────────────────────────
  const SECTION_CHILD_LABELS = ['identified control', 'frequency of control', 'walkthrough evidence'];
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (let i = dataStartRow; i < rows.length; i++) {
    const r = rows[i];
    const labelA = cleanCell(r[0]);
    if (!labelA) continue;

    const lc = labelA.toLowerCase();
    const isChild = SECTION_CHILD_LABELS.some(n => lc.startsWith(n));

    const blankStages: Record<StageKey, StageValue> = {
      initiation: null, process: null, recording: null, reporting: null,
    };

    if (isChild && current) {
      const target = lc.startsWith('identified control') ? current.control
        : lc.startsWith('frequency of control') ? current.frequency
        : current.evidence;
      for (const stage of STAGES) target[stage] = cleanCell(r[STAGE_COL[stage]]);
      continue;
    }

    // A new section header row.
    current = {
      name: labelA,
      stages: { ...blankStages },
      control: { ...blankStages },
      frequency: { ...blankStages },
      evidence: { ...blankStages },
      weakness: cleanCell(r[WEAKNESS_COL]),
      evidenceSummary: cleanCell(r[EVIDENCE_COL]),
    };
    for (const stage of STAGES) current.stages[stage] = cleanCell(r[STAGE_COL[stage]]);
    sections.push(current);
  }

  return {
    processName: (rows[4]?.[0] ? String(rows[4][0]).trim() : '') || sheetName.replace(/^walkthrough\s*-\s*/i, '').trim() || 'Imported Process',
    ...meta,
    sections,
  };
}

/** Best-effort Excel date → ISO. XLSX returns date cells as serial
 *  numbers by default; when a cell isn't a date we just stringify. */
function excelDateToIso(val: string): string {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 10000) return val;
  // Excel's epoch quirk: treats 1900 as leap-year. The `+1` correction
  // comes from https://docs.microsoft.com/.../1900-is-incorrectly-handled-as-a-leap-year.
  const epoch = Date.UTC(1899, 11, 30);
  const ms = n * 86400 * 1000;
  const d = new Date(epoch + ms);
  return d.toISOString().slice(0, 10);
}

/* ─── FlowStep conversion ─────────────────────────────────────── */

export interface FlowStep {
  id: string;
  label: string;
  type: 'start' | 'action' | 'decision' | 'end';
  next: string[];
  condition?: string;
  sourceDoc?: string;
  outputDoc?: string;
  responsible?: string;
  docLocation?: string;
  isSignificantControl?: boolean;
}

/** Convert a parsed walkthrough into a linear flowchart:
 *  START → (for each section: each non-empty stage becomes an
 *   ACTION node, left-to-right) → END
 *  Sections are joined end-to-end so the user sees the same order
 *  as the Excel template. The node label is `${section} — ${stage}`
 *  and the description concatenates stage text + control + frequency
 *  + evidence so nothing is lost. Weakness rows get turned into a
 *  DECISION node after the section's last action so the graph still
 *  surfaces them visually. */
export function parsedWalkthroughToFlowSteps(parsed: ParsedWalkthrough): FlowStep[] {
  const steps: FlowStep[] = [];
  const mkId = (() => { let n = 0; return () => `imp_${++n}`; })();
  const startId = mkId();
  steps.push({ id: startId, label: 'Start', type: 'start', next: [] });

  let prevId = startId;

  const stageLabel: Record<StageKey, string> = {
    initiation: 'Initiation', process: 'Process', recording: 'Recording', reporting: 'Reporting',
  };

  for (const section of parsed.sections) {
    for (const stage of STAGES) {
      const text = section.stages[stage];
      if (!text) continue;
      const id = mkId();
      const control = section.control[stage];
      const frequency = section.frequency[stage];
      const evidence = section.evidence[stage];
      const descParts: string[] = [text];
      if (control) descParts.push(`Control & Assertion: ${control}`);
      if (frequency) descParts.push(`Frequency: ${frequency}`);
      if (evidence) descParts.push(`Evidence: ${evidence}`);
      const label = `${section.name} — ${stageLabel[stage]}\n\n${descParts.join('\n\n')}`;
      steps.push({
        id,
        label,
        type: 'action',
        next: [],
        isSignificantControl: !!(control && control.length > 0),
      });
      // Link previous node to this one.
      const prev = steps.find(s => s.id === prevId);
      if (prev) prev.next = [id];
      prevId = id;
    }
    // Weakness → DECISION node (only if not 'None identified').
    if (section.weakness) {
      const id = mkId();
      steps.push({
        id,
        label: `Weakness / ML point — ${section.name}\n\n${section.weakness}`,
        type: 'decision',
        next: [],
      });
      const prev = steps.find(s => s.id === prevId);
      if (prev) prev.next = [id];
      prevId = id;
    }
  }

  const endId = mkId();
  steps.push({ id: endId, label: 'End', type: 'end', next: [] });
  const prev = steps.find(s => s.id === prevId);
  if (prev) prev.next = [endId];

  return steps;
}
