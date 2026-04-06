import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateSasUrl } from '@/lib/azure-blob';

/**
 * GET /api/documents/preview?path=documents/clientId/engId/file.pdf
 * Returns a redirect to a time-limited SAS URL for the document.
 * SAS URL expires in 15 minutes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const path = req.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'path parameter required' }, { status: 400 });
  }

  const containerName = req.nextUrl.searchParams.get('container') || 'upload-inbox';

  try {
    const sasUrl = generateSasUrl(path, containerName, 15);
    return NextResponse.redirect(sasUrl);
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to generate preview URL: ' + err.message }, { status: 500 });
  }
}
