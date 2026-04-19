import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';

/**
 * GET /api/portal/documents/:id/download?clientId=X
 *
 * Streams a PortalDocument's .docx back to the client. Scopes by
 * clientId so a logged-in portal user for client A can't craft a
 * URL to fetch client B's documents.
 *
 * Avoids SAS-redirect and serves the blob inline — simpler for the
 * portal UI (one fetch + blob → window.URL.createObjectURL) and
 * avoids leaking long-lived SAS URLs in browser history.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: 'document id required' }, { status: 400 });
  }

  try {
    const doc = await prisma.portalDocument.findFirst({
      where: { id, clientId, isActive: true },
    });
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const buffer = await downloadBlob(doc.blobPath, doc.containerName);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': doc.contentType,
        'Content-Disposition': `attachment; filename="${doc.fileName.replace(/"/g, '')}"`,
      },
    });
  } catch (err: any) {
    console.error('[portal/documents/:id/download] failed', err);
    return NextResponse.json({ error: err?.message || 'Download failed' }, { status: 500 });
  }
}
