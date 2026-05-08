import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parseWalkthroughXlsx, parsedWalkthroughToFlowSteps } from '@/lib/walkthrough-excel-parser';

export const maxDuration = 30;

/**
 * POST /api/engagements/[id]/walkthroughs/import
 *
 * Accepts a multipart upload with one .xlsx file under the `file`
 * field. Parses the firm's legacy walkthrough template and returns:
 *   - `parsed`   — the raw structured metadata + sections (useful for
 *                  previewing before committing the import).
 *   - `steps`    — a FlowStep[] ready to drop into
 *                  `walkthrough_status.<processKey>.flowchart`.
 *
 * We deliberately *don't* persist anything here: the UI decides
 * which process tab the imported flowchart lands in, and whether to
 * replace or merge with whatever is already there.
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file uploaded — send a multipart form with a "file" field.' }, { status: 400 });
  }
  const name = (file as File).name || 'walkthrough.xlsx';
  if (!/\.xlsx$/i.test(name)) {
    return NextResponse.json({ error: 'Only .xlsx uploads are supported.' }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseWalkthroughXlsx(buffer);
  } catch (err: any) {
    return NextResponse.json({ error: `Could not parse workbook: ${err?.message || 'unknown error'}` }, { status: 422 });
  }

  const steps = parsedWalkthroughToFlowSteps(parsed);
  // Summary fields so the UI can show an "Imported N sections / M
  // steps" banner without re-walking the nested structure.
  const summary = {
    processName: parsed.processName,
    sectionCount: parsed.sections.length,
    stepCount: steps.filter(s => s.type === 'action' || s.type === 'decision').length,
  };

  return NextResponse.json({ parsed, steps, summary });
}
