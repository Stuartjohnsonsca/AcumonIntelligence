import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { parseTaxonomyFromUrl } from '@/lib/taxonomy-parser';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
      const accounts = await parseTaxonomyFromUrl(url);
      return NextResponse.json({
        success: true,
        accountCount: accounts.length,
        sampleAccounts: accounts.slice(0, 5).map(a => ({
          accountCode: a.accountCode,
          accountName: a.accountName,
          categoryType: a.categoryType,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      return NextResponse.json({ success: false, error: msg });
    }
  } catch (err) {
    console.error('[Taxonomy:Test]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
