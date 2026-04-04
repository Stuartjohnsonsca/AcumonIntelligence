import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DEFAULT_AGREED_DATES, DEFAULT_INFO_REQUEST_STANDARD, RMM_MANDATORY_ROWS } from '@/types/methodology';

// GET /api/engagements?clientId=X&periodId=Y&auditType=Z
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const periodId = searchParams.get('periodId');
  const auditType = searchParams.get('auditType');

  const prior = searchParams.get('prior') === 'true';
  const currentEngagementId = searchParams.get('currentEngagementId');

  // Prior engagement lookup — find most recent engagement for this client/auditType excluding current
  if (prior && clientId && auditType) {
    try {
      const where: any = { clientId, auditType };
      if (currentEngagementId) where.id = { not: currentEngagementId };
      const engagement = await prisma.auditEngagement.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { clientName: true } },
          period: { select: { startDate: true, endDate: true } },
        },
      });
      return NextResponse.json({ engagement });
    } catch (err) {
      console.error('Error fetching prior engagement:', err);
      return NextResponse.json({ error: 'Failed to fetch prior engagement' }, { status: 500 });
    }
  }

  if (!clientId || !periodId || !auditType) {
    return NextResponse.json({ error: 'clientId, periodId, and auditType are required' }, { status: 400 });
  }

  try {
    const engagement = await prisma.auditEngagement.findUnique({
      where: {
        clientId_periodId_auditType: { clientId, periodId, auditType },
      },
      include: {
        teamMembers: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { joinedAt: 'asc' } },
        specialists: { orderBy: { specialistType: 'asc' } },
        contacts: { orderBy: { isMainContact: 'desc' } },
        agreedDates: { orderBy: { sortOrder: 'asc' } },
        informationRequests: { orderBy: { sortOrder: 'asc' } },
        client: { select: { clientName: true } },
        period: { select: { startDate: true, endDate: true } },
      },
    });

    return NextResponse.json({ engagement });
  } catch (err) {
    console.error('Error fetching engagement:', err);
    return NextResponse.json({ error: 'Failed to fetch engagement' }, { status: 500 });
  }
}

// POST /api/engagements - Create a new engagement
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { clientId, periodId, auditType } = body;

    if (!clientId || !periodId || !auditType) {
      return NextResponse.json({ error: 'clientId, periodId, and auditType are required' }, { status: 400 });
    }

    const firmId = session.user.firmId;
    if (!firmId) {
      return NextResponse.json({ error: 'User must belong to a firm' }, { status: 400 });
    }

    // Verify client belongs to user's firm
    const client = await prisma.client.findFirst({
      where: { id: clientId, firmId },
    });
    if (!client) {
      return NextResponse.json({ error: 'Client not found or access denied' }, { status: 403 });
    }

    // Check for existing engagement
    const existing = await prisma.auditEngagement.findUnique({
      where: { clientId_periodId_auditType: { clientId, periodId, auditType } },
    });
    if (existing) {
      return NextResponse.json({ error: 'Engagement already exists for this client/period/type' }, { status: 409 });
    }

    // Snapshot current methodology: get latest config or create one
    let methodologyConfig = await prisma.methodologyConfig.findFirst({
      where: { firmId, auditType, isActive: true },
      orderBy: { version: 'desc' },
    });

    // If no config exists, create a snapshot of current templates
    if (!methodologyConfig) {
      const allTemplates = await prisma.methodologyTemplate.findMany({
        where: { firmId, auditType: { in: [auditType, 'ALL'] } },
      });
      const riskTables = await prisma.methodologyRiskTable.findMany({ where: { firmId } });
      const toolSettings = await prisma.methodologyToolSetting.findMany({ where: { firmId } });

      methodologyConfig = await prisma.methodologyConfig.create({
        data: {
          firmId,
          auditType,
          version: 1,
          isActive: true,
          createdById: session.user.id,
          config: {
            templates: allTemplates.map(t => ({ type: t.templateType, auditType: t.auditType, items: t.items })),
            riskTables: riskTables.map(r => ({ type: r.tableType, data: r.data })),
            toolSettings: toolSettings.map(s => ({ tool: s.toolName, method: s.methodName, availability: s.availability, auditType: s.auditType })),
            snapshotDate: new Date().toISOString(),
          },
        },
      });
    }

    // Load default agreed dates from methodology templates or use defaults
    const agreedDatesTemplate = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: 'agreed_dates', auditType } },
    });
    const agreedDateItems: string[] = agreedDatesTemplate?.items
      ? (agreedDatesTemplate.items as string[])
      : DEFAULT_AGREED_DATES;

    // Load default info request items
    const infoTemplate = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: 'information_request', auditType } },
    });
    const infoRequestItems: string[] = infoTemplate?.items
      ? (infoTemplate.items as string[])
      : DEFAULT_INFO_REQUEST_STANDARD;

    // Create engagement with seeded data
    const engagement = await prisma.auditEngagement.create({
      data: {
        clientId,
        periodId,
        firmId,
        auditType,
        status: 'pre_start',
        methodologyVersionId: methodologyConfig?.id || null,
        createdById: session.user.id,
        agreedDates: {
          create: agreedDateItems.map((desc, i) => ({
            description: desc,
            sortOrder: i,
            progress: 'Not Started',
          })),
        },
        informationRequests: {
          create: infoRequestItems.map((desc, i) => ({
            description: desc,
            isIncluded: true,
            sortOrder: i,
          })),
        },
        rmmRows: {
          create: RMM_MANDATORY_ROWS.map(row => ({
            lineItem: row.lineItem,
            lineType: 'fs_line',
            isMandatory: true,
            sortOrder: row.sortOrder,
          })),
        },
      },
      include: {
        teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
        specialists: true,
        contacts: true,
        agreedDates: { orderBy: { sortOrder: 'asc' } },
        informationRequests: { orderBy: { sortOrder: 'asc' } },
        client: { select: { clientName: true } },
        period: { select: { startDate: true, endDate: true } },
      },
    });

    return NextResponse.json({ engagement }, { status: 201 });
  } catch (err) {
    console.error('Error creating engagement:', err);
    return NextResponse.json({ error: 'Failed to create engagement' }, { status: 500 });
  }
}
