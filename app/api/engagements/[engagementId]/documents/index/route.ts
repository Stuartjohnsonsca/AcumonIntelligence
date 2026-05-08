// POST /api/engagements/:engagementId/documents/index
// Body: { documentId?: string }   // optional — index a single doc
//                                    omitted → index all unindexed docs
//                                    in this engagement
//
// Backfill / on-demand index trigger for InterrogateBot's document RAG.
// Documents uploaded via /api/upload/document are auto-indexed inline.
// This endpoint exists for:
//   - bulk-indexing pre-existing docs that pre-date the indexing pipeline
//   - re-indexing one document after content changes (we delete + recreate
//     all chunks — see lib/document-indexing.ts).

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { indexDocument } from '@/lib/document-indexing';

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const targetId = typeof body.documentId === 'string' ? body.documentId : null;

  let docIds: string[];
  if (targetId) {
    const d = await prisma.auditDocument.findUnique({
      where: { id: targetId },
      select: { id: true, engagementId: true, storagePath: true },
    });
    if (!d || d.engagementId !== engagementId) {
      return NextResponse.json({ error: 'Document not in this engagement' }, { status: 404 });
    }
    if (!d.storagePath) return NextResponse.json({ error: 'Document has no uploaded file' }, { status: 400 });
    docIds = [d.id];
  } else {
    // All docs in the engagement that have a blob and no chunks yet.
    const docs = await prisma.auditDocument.findMany({
      where: {
        engagementId,
        storagePath: { not: null },
      },
      select: { id: true, _count: { select: { chunks: true } } },
    });
    docIds = docs.filter(d => d._count.chunks === 0).map(d => d.id);
  }

  // Run sequentially to keep Together API rate-limit pressure manageable.
  const results = [];
  for (const id of docIds) {
    try {
      const r = await indexDocument(id);
      results.push(r);
    } catch (err) {
      results.push({
        documentId: id,
        status: 'failed' as const,
        chunkCount: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalChunks = results.reduce((s, r) => s + r.chunkCount, 0);
  return NextResponse.json({ count: results.length, totalChunks, results });
}
