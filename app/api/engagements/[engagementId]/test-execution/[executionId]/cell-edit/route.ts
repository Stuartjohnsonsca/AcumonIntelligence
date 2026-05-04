import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { prisma } from '@/lib/db';

/**
 * Cell-edit endpoint for action_pipeline step outputs.
 *
 * Lets the auditor override the `calculated` and `notes` cells on
 * recalc-style data_table rows that the handler couldn't compute
 * automatically (rows marked `pass_fail: 'review'` — sum-of-years
 * digits, half-year convention, units-of-production, anything the
 * auto-recalc doesn't cover). The override:
 *
 *   - merges into pipelineState[stepIndex].recalc_table
 *   - recomputes per-row variance + pass_fail using the tolerance
 *     persisted on the step's output
 *   - recomputes the table totals (total_calculated / total_booked
 *     / total_variance / red_count / green_count /
 *     unrecalculated_count) and the findings subset
 *   - flips overall pass_fail
 *
 * Generic enough to handle any handler that emits a recalc_table
 * with the standard shape. Other future tables can opt in by
 * matching the same column conventions or by extending the
 * recompute branch below.
 */

interface RowEdit {
  rowIndex: number;
  calculated?: number | null;
  notes?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[,£$€\s]/g, '').replace(/\((.+)\)/, '-$1'));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string; executionId: string }> },
) {
  const { engagementId, executionId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const { stepIndex, rowEdits } = await req.json() as { stepIndex?: number; rowEdits?: RowEdit[] };
  if (typeof stepIndex !== 'number' || !Array.isArray(rowEdits) || rowEdits.length === 0) {
    return NextResponse.json({ error: 'stepIndex and non-empty rowEdits are required' }, { status: 400 });
  }

  const execution = await prisma.testExecution.findFirst({
    where: { id: executionId, engagementId },
  });
  if (!execution) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });

  const pipelineState = ((execution.pipelineState as Record<number, Record<string, any>> | null) || {});
  const stepOutput = pipelineState[stepIndex];
  if (!stepOutput) return NextResponse.json({ error: 'No output for that step' }, { status: 404 });

  const table = (stepOutput.recalc_table || stepOutput.data_table) as Array<Record<string, any>> | undefined;
  if (!Array.isArray(table)) return NextResponse.json({ error: 'Step output has no editable table' }, { status: 400 });

  const tolerance = Math.max(0, Number(stepOutput.tolerance_gbp ?? 1));

  // Apply per-row edits, recompute that row's variance and pass_fail.
  const editedTable = table.map(r => ({ ...r }));
  for (const edit of rowEdits) {
    const idx = edit.rowIndex;
    if (idx < 0 || idx >= editedTable.length) continue;
    const row = editedTable[idx];
    if (edit.calculated !== undefined) {
      row.calculated = edit.calculated === null ? null : round2(num(edit.calculated));
    }
    if (edit.notes !== undefined) {
      // Append "(manual override)" so the audit trail makes clear
      // which rows the auditor adjusted by hand.
      const trimmed = String(edit.notes).trim();
      row.notes = trimmed ? `${trimmed} (manual override)` : '(manual override)';
    }

    // Recompute variance + pass_fail for this row.
    const calculated = row.calculated;
    const booked = num(row.booked);
    if (calculated == null) {
      row.variance = null;
      row.pass_fail = 'review';
    } else {
      const variance = num(calculated) - booked;
      row.variance = round2(variance);
      row.pass_fail = Math.abs(variance) <= tolerance ? 'pass' : 'fail';
    }
  }

  // Recompute table-level totals + findings.
  let totalCalc = 0;
  let totalBooked = 0;
  let red = 0;
  let green = 0;
  let skipped = 0;
  for (const r of editedTable) {
    if (r.calculated == null) {
      skipped++;
      continue;
    }
    totalCalc += num(r.calculated);
    totalBooked += num(r.booked);
    if (r.pass_fail === 'fail') red++;
    else if (r.pass_fail === 'pass') green++;
  }
  const findings = editedTable.filter(r => r.pass_fail === 'fail');
  const overall: 'pass' | 'fail' = red === 0 ? 'pass' : 'fail';

  pipelineState[stepIndex] = {
    ...stepOutput,
    recalc_table: editedTable,
    data_table: editedTable,
    total_calculated: round2(totalCalc),
    total_booked: round2(totalBooked),
    total_variance: round2(totalCalc - totalBooked),
    red_count: red,
    green_count: green,
    unrecalculated_count: skipped,
    findings,
    pass_fail: overall,
  };

  await prisma.testExecution.update({
    where: { id: executionId },
    data: { pipelineState: pipelineState as any },
  });

  return NextResponse.json({ ok: true, output: pipelineState[stepIndex] });
}
