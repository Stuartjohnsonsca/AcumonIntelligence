import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// POST: Upload PAR items to client portal for management response
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  // TODO: Upload to portal as a request for information
  // For now, return success so the UI can update
  return NextResponse.json({ success: true, sentCount: items.length });
}
