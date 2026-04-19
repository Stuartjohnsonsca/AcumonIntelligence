import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/portal/documents?clientId=X&engagementId=Y&category=Z
 *
 * Returns the list of documents the firm has pushed to the client via
 * the Client Portal (e.g. Planning Letters). Filtered by clientId;
 * engagementId + category are optional narrowings.
 *
 * Shape matches the pattern of sibling portal endpoints (periods,
 * requests, evidence): clientId passed in query, no deep auth in MVP.
 * Production tightening: validate the portal-session token against
 * the user's allocated clients — same TODO the other endpoints carry.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const engagementId = searchParams.get('engagementId');
  const category = searchParams.get('category');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  try {
    const where: any = { clientId, isActive: true };
    if (engagementId) where.engagementId = engagementId;
    if (category) where.category = category;

    const docs = await prisma.portalDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Shape for the portal UI — hide internal-only fields (blobPath,
    // containerName) but keep enough metadata for the document list
    // to render ("Planning Letter", "sent by Jane on 19 April", etc.).
    return NextResponse.json({
      documents: docs.map(d => ({
        id: d.id,
        name: d.name,
        description: d.description,
        category: d.category,
        fileName: d.fileName,
        contentType: d.contentType,
        fileSize: d.fileSize,
        uploadedByName: d.uploadedByName,
        createdAt: d.createdAt.toISOString(),
        engagementId: d.engagementId,
      })),
    });
  } catch (err: any) {
    console.error('[portal/documents] failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to load documents' }, { status: 500 });
  }
}
