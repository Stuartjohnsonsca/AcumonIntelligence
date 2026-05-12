import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractTaxComp } from '@/lib/tax-comp-extractor';
import JSZip from 'jszip';

/**
 * POST /api/engagements/[engagementId]/tax-on-profits/extract
 *
 * Body: { documentId: string }
 *
 * Pulls the supplied AuditDocument server-side, extracts plain text
 * (PDF / DOCX / XLSX / CSV / TXT) and asks the LLM to emit a
 * structured payload of CT-computation adjustment lines + headline
 * accounting profit / tax charge values.
 *
 * Response: { data: ExtractedTaxComp | null, model?, error? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, period: { select: { startDate: true, endDate: true } } },
  });
  if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const documentId: string = typeof body?.documentId === 'string' ? body.documentId : '';
  if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });

  const doc = await prisma.auditDocument.findFirst({
    where: { id: documentId, engagementId },
    select: { documentName: true, storagePath: true, containerName: true, mimeType: true },
  });
  if (!doc || !doc.storagePath) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  let text = '';
  try {
    const buffer = await downloadBlob(doc.storagePath, doc.containerName || 'upload-inbox');
    text = await extractTextFromBuffer(buffer, doc.documentName || 'document', doc.mimeType || '');
  } catch (err: any) {
    return NextResponse.json({ data: null, error: `Could not read document: ${err?.message || err}` });
  }
  if (!text || text.trim().length < 10) {
    return NextResponse.json({ data: null, error: 'Document contained no readable text' });
  }

  const out = await aiExtractTaxComp({
    textContent: text,
    periodStartIso: engagement.period?.startDate?.toISOString().slice(0, 10),
    periodEndIso: engagement.period?.endDate?.toISOString().slice(0, 10),
  });

  return NextResponse.json(out);
}

async function extractTextFromBuffer(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const lower = (filename + ' ' + mimeType).toLowerCase();
  if (lower.includes('pdf')) {
    const r = await processPdf(buffer, 20);
    return r.mode === 'text' ? (r.text || '') : '';
  }
  if (lower.includes('.txt') || lower.includes('text/')) {
    return buffer.toString('utf-8');
  }
  if (lower.includes('.csv') || lower.includes('csv')) {
    return buffer.toString('utf-8');
  }
  if (lower.includes('.xlsx') || lower.includes('.xls') || lower.includes('sheet') || lower.includes('excel')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      return wb.SheetNames.map((n: string) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
        return csv && csv.trim() ? `=== Sheet: ${n} ===\n${csv}` : '';
      }).filter(Boolean).join('\n\n');
    } catch { return ''; }
  }
  if (lower.includes('.docx') || lower.includes('word')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml')?.async('string');
      if (!docXml) return '';
      const wMatches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      return wMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
    } catch { return ''; }
  }
  try { return buffer.toString('utf-8'); } catch { return ''; }
}
