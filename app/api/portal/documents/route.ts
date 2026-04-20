import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authorisePortalTenant } from '@/lib/portal-endpoint-auth';

/**
 * GET /api/portal/documents?token=X&clientId=Y&engagementId=Z&category=W
 *
 * Returns the list of documents the firm has pushed to the client via
 * the Client Portal (e.g. Planning Letters). Filtered by clientId;
 * engagementId + category are optional narrowings.
 *
 * Authorisation: portal callers (token) must own the clientId via a
 * ClientPortalUser row; firm callers (auth session) are passed
 * through so the firm-side methodology pages keep working.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const engagementId = searchParams.get('engagementId');
  const category = searchParams.get('category');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const guard = await authorisePortalTenant(req, { clientId });
  if (!guard.ok) return guard.response;

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
