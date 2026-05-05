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
        select: {
          id: true,
          clientId: true,
          periodId: true,
          firmId: true,
          auditType: true,
          status: true,
          createdAt: true,
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

  // List mode — when no specific (clientId, periodId, auditType) triple
  // is supplied, return engagements for the caller's firm. Used by the
  // template editor (and any other admin screen that wants to let the
  // user pick an engagement from a flat list).
  if (!clientId && !periodId && !auditType) {
    const limitRaw = Number(searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    try {
      const firmId = session.user.firmId;
      const engagements = await prisma.auditEngagement.findMany({
        where: session.user.isSuperAdmin ? {} : { firmId },
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          auditType: true,
          status: true,
          startedAt: true,
          client: { select: { id: true, clientName: true } },
          period: { select: { id: true, startDate: true, endDate: true } },
        },
      });
      return NextResponse.json({ engagements });
    } catch (err) {
      console.error('Error listing engagements:', err);
      return NextResponse.json({ error: 'Failed to list engagements' }, { status: 500 });
    }
  }

  if (!clientId || !periodId || !auditType) {
    return NextResponse.json({ error: 'clientId, periodId, and auditType are required' }, { status: 400 });
  }

  try {
    // Explicit select (rather than include) so Prisma doesn't
    // implicit-SELECT every column on AuditEngagement — including new
    // Portal Principal columns that may not yet be in the live DB.
    // The list below mirrors what hooks/useEngagement.ts + the
    // methodology tabs actually consume.
    const engagement = await prisma.auditEngagement.findUnique({
      where: {
        clientId_periodId_auditType: { clientId, periodId, auditType },
      },
      select: {
        id: true,
        clientId: true,
        periodId: true,
        firmId: true,
        auditType: true,
        status: true,
        methodologyVersionId: true,
        infoRequestType: true,
        hardCloseDate: true,
        isGroupAudit: true,
        isNewClient: true,
        tbViewMode: true,
        tbXeroSummary: true,
        planCreated: true,
        farEnabled: true,
        farAssetType: true,
        farScope: true,
        farCategories: true,
        createdById: true,
        startedAt: true,
        completedAt: true,
        priorPeriodEngagementId: true,
        createdAt: true,
        updatedAt: true,
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
  } catch (err: any) {
    const code = err?.code || 'unknown';
    console.error('[engagements/GET] findUnique failed:', { code, message: err?.message, meta: err?.meta });
    return NextResponse.json({
      error: 'Failed to fetch engagement',
      code,
      detail: (err?.message || '').slice(0, 300),
    }, { status: 500 });
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

    // Create engagement with seeded data.
    // Explicit select on the return to avoid implicit SELECT * — the
    // 2026-04-24 Portal Principal migration added columns that may
    // not yet exist in every database, and Prisma would otherwise
    // SELECT them after the INSERT and throw P2022. This scalar
    // list covers exactly what the client needs; no new fields
    // flow into the create output unless explicitly added here.
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
      select: {
        id: true,
        clientId: true,
        periodId: true,
        firmId: true,
        auditType: true,
        status: true,
        methodologyVersionId: true,
        isGroupAudit: true,
        isNewClient: true,
        infoRequestType: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
        specialists: true,
        contacts: true,
        agreedDates: { orderBy: { sortOrder: 'asc' } },
        informationRequests: { orderBy: { sortOrder: 'asc' } },
        client: { select: { clientName: true } },
        period: { select: { startDate: true, endDate: true } },
      },
    });

    // Auto-add the creator as an RI team member. Two reasons:
    //   1. Independence gate uses team membership as its trigger;
    //      without this the creator never sees the questionnaire on
    //      first open of an engagement they just made.
    //   2. RI is the engagement-leader role; the engagement creator
    //      is overwhelmingly the right person for it. They can change
    //      their role on the Opening tab, and the team-save endpoint
    //      tolerates the override. Idempotent via upsert so a retry
    //      never duplicates.
    try {
      await prisma.auditTeamMember.upsert({
        where: { engagementId_userId: { engagementId: engagement.id, userId: session.user.id } },
        update: {},
        create: { engagementId: engagement.id, userId: session.user.id, role: 'RI', sortOrder: 0 },
      });
    } catch (err) {
      console.error('[engagements/POST] auto-add creator to team failed:', err);
    }

    return NextResponse.json({ engagement }, { status: 201 });
  } catch (err: any) {
    // Surface Prisma error detail so schema-drift issues (P2022,
    // P2021, P2002 unique collisions) are diagnosable without
    // ssh'ing into logs. "Failed to create engagement" on its own
    // obscured a migration-missing root cause earlier today.
    const code = err?.code || 'unknown';
    const message = err?.message || String(err);
    console.error('[engagements/POST] create failed:', { code, message, meta: err?.meta });
    let hint: string | null = null;
    if (code === 'P2022') {
      hint = 'A column referenced by Prisma is missing in the database. Run scripts/sql/portal-principal.sql (and any other pending migrations) in Supabase SQL Editor, then retry.';
    } else if (code === 'P2002') {
      hint = 'An engagement with this client / period / audit type already exists.';
    }
    return NextResponse.json({
      error: 'Failed to create engagement',
      code,
      detail: message.slice(0, 300),
      hint,
    }, { status: 500 });
  }
}
