import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import { processPdf } from '@/lib/pdf-to-images';
import { aiExtractLoan } from '@/lib/loan-extractor';
import JSZip from 'jszip';

/**
 * POST /api/engagements/[engagementId]/loan-calculator/extract
 *
 * Body: { documentIds: string[], side: 'receivable'|'liability', plainText?: string }
 *
 * Pulls the supplied AuditDocument blobs server-side, extracts text from
 * each (PDF / DOCX / XLSX / TXT), concatenates them, and asks the
 * Together LLM to emit a structured loan JSON via lib/loan-extractor.
 * If `plainText` is supplied (manual-entry shortcut), we use it instead
 * of fetching documents — handy when the auditor pastes a snippet in
 * the "From User" tile.
 *
 * Response: { loans: ExtractedLoan[], rawAiResponse?, model?, error? }
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
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const side = body?.side === 'receivable' ? 'receivable' : 'liability';
  const plainText: string = typeof body?.plainText === 'string' ? body.plainText : '';
  const documentIds: string[] = Array.isArray(body?.documentIds)
    ? body.documentIds.filter((s: unknown): s is string => typeof s === 'string')
    : [];

  // Pull text from each requested document.
  const parts: string[] = [];
  for (const docId of documentIds) {
    const doc = await prisma.auditDocument.findFirst({
      where: { id: docId, engagementId },
      select: { documentName: true, storagePath: true, containerName: true, mimeType: true },
    });
    if (!doc || !doc.storagePath) continue;
    try {
      const buffer = await downloadBlob(doc.storagePath, doc.containerName || 'upload-inbox');
      const text = await extractTextFromBuffer(buffer, doc.documentName || 'document', doc.mimeType || '');
      if (text && text.trim().length > 10) {
        parts.push(`--- ${doc.documentName || docId} ---\n${text}`);
      }
    } catch (err: any) {
      console.warn('[loan-calculator/extract] failed to read', docId, err?.message);
    }
  }
  if (plainText.trim().length > 10) parts.push(`--- User-entered snippet ---\n${plainText}`);

  if (parts.length === 0) {
    return NextResponse.json({ loans: [], error: 'No readable source content supplied' });
  }

  const out = await aiExtractLoan({
    side,
    textContent: parts.join('\n\n'),
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
  // Fallback — try utf-8 decode.
  try { return buffer.toString('utf-8'); } catch { return ''; }
}
