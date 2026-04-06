import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateSasUrl } from '@/lib/azure-blob';
import { prisma } from '@/lib/db';

/**
 * GET /api/documents/preview?path=...  or  ?docId=...
 * Returns a redirect to a time-limited SAS URL for the document.
 * SAS URL expires in 15 minutes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let path = req.nextUrl.searchParams.get('path');
  const docId = req.nextUrl.searchParams.get('docId');
  const containerName = req.nextUrl.searchParams.get('container') || 'upload-inbox';

  // If docId provided, look up the storage path from the database
  if (!path && docId) {
    try {
      const doc = await prisma.auditDocument.findUnique({
        where: { id: docId },
        select: { storagePath: true, containerName: true },
      });
      if (doc?.storagePath) {
        path = doc.storagePath;
      }
    } catch {}
  }

  if (!path) {
    return NextResponse.json({ error: 'path or docId parameter required' }, { status: 400 });
  }

  try {
    const sasUrl = generateSasUrl(path, containerName, 15);
    // Return URL as JSON so clients can use it directly (redirects fail in iframes)
    if (req.nextUrl.searchParams.get('json') === '1') {
      return NextResponse.json({ url: sasUrl });
    }
    return NextResponse.redirect(sasUrl);
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to generate preview URL: ' + err.message }, { status: 500 });
  }
}
