import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parseTaxonomyFromUrl, upsertTaxonomyToDb } from '@/lib/taxonomy-parser';

// GET: Retrieve current taxonomy configuration
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const firmId = request.nextUrl.searchParams.get('firmId') || session.user.firmId;

    const firm = await prisma.firm.findUnique({
      where: { id: firmId },
      select: {
        taxonomySourceType: true,
        taxonomyEndpointUrl: true,
        chartOfAccountsFileName: true,
        chartOfAccountsUpdatedAt: true,
      },
    });

    if (!firm) {
      return NextResponse.json({ error: 'Firm not found' }, { status: 404 });
    }

    const accountCount = await prisma.firmChartOfAccount.count({ where: { firmId } });

    return NextResponse.json({
      ...firm,
      accountCount,
    });
  } catch (err) {
    console.error('[Taxonomy:GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT: Save taxonomy source configuration
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isFirmAdmin = session.user.isFirmAdmin || session.user.isSuperAdmin;
    if (!isFirmAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { firmId, sourceType, endpointUrl } = await request.json();
    const targetFirmId = firmId || session.user.firmId;

    if (!sourceType || !['url', 'file'].includes(sourceType)) {
      return NextResponse.json({ error: 'sourceType must be "url" or "file"' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      taxonomySourceType: sourceType,
    };

    if (sourceType === 'url') {
      if (!endpointUrl) {
        return NextResponse.json({ error: 'endpointUrl is required for URL source type' }, { status: 400 });
      }
      updateData.taxonomyEndpointUrl = endpointUrl;

      // Fetch and parse from URL
      try {
        const accounts = await parseTaxonomyFromUrl(endpointUrl);
        if (accounts.length === 0) {
          return NextResponse.json({ error: 'No valid accounts found at the endpoint' }, { status: 400 });
        }

        await prisma.firm.update({ where: { id: targetFirmId }, data: updateData });
        const result = await upsertTaxonomyToDb(targetFirmId, accounts);

        return NextResponse.json({
          success: true,
          sourceType,
          ...result,
          totalAccounts: accounts.length,
        });
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown error';
        return NextResponse.json({ error: `Failed to fetch taxonomy: ${msg}` }, { status: 400 });
      }
    }

    // For file type, just save the config — file upload happens via /upload endpoint
    await prisma.firm.update({ where: { id: targetFirmId }, data: updateData });

    return NextResponse.json({ success: true, sourceType });
  } catch (err) {
    console.error('[Taxonomy:PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
