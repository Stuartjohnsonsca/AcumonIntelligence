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
        framework: true,
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
        importOptions: true,
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

    // Load default info request items. The Schedule Designer's "Info
    // Request (Standard)" list is stored under templateType
    // 'information_request_standard'; previously this seed read
    // 'information_request' (a key nothing ever wrote) and silently
    // fell through to the hardcoded DEFAULT_INFO_REQUEST_STANDARD, so
    // firm customisations never reached new engagements. Lookup order:
    //   1. firm's `information_request_standard` row for this audit type
    //   2. firm's `information_request_standard` row for 'ALL'
    //   3. legacy `information_request` row (back-compat for any firm
    //      that saved under the old key before the rename)
    //   4. hardcoded default
    // Each list item is { description, action? } — back-compat coerces
    // legacy string[] into { description } entries.
    const [infoStdAuditType, infoStdAll, infoLegacy] = await Promise.all([
      prisma.methodologyTemplate.findUnique({
        where: { firmId_templateType_auditType: { firmId, templateType: 'information_request_standard', auditType } },
      }).catch(() => null),
      prisma.methodologyTemplate.findUnique({
        where: { firmId_templateType_auditType: { firmId, templateType: 'information_request_standard', auditType: 'ALL' } },
      }).catch(() => null),
      prisma.methodologyTemplate.findUnique({
        where: { firmId_templateType_auditType: { firmId, templateType: 'information_request', auditType } },
      }).catch(() => null),
    ]);
    const rawItems = (infoStdAuditType?.items ?? infoStdAll?.items ?? infoLegacy?.items) as any;
    // Items shape evolved over time, in order of recency:
    //   1. `{ items: [{description, action?}], defaultAction? }` (Schedule
    //      Designer post-action-feature)
    //   2. `[{description, action?}]`                              (per-item rich entries, no list meta)
    //   3. `string[]`                                              (legacy plain list)
    const itemsArr: any[] = Array.isArray(rawItems)
      ? rawItems
      : (rawItems && typeof rawItems === 'object' && Array.isArray(rawItems.items))
        ? rawItems.items
        : [];
    const defaultAction: string | null =
      (rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems) && typeof rawItems.defaultAction === 'string')
        ? rawItems.defaultAction
        : null;
    // Each seeded row carries its description AND the resolved action
    // (per-item override first, then the list-level default). Falls
    // back to the hardcoded constant when nothing's on disk yet.
    const VALID_ACTIONS = new Set(['request_portal', 'message_client', 'third_party']);
    const infoRequestSeed: Array<{ description: string; action: string | null }> = itemsArr.length > 0
      ? itemsArr
          .map((it: any) => {
            const description = typeof it === 'string' ? it : (it?.description ?? '');
            const rawAction = typeof it === 'object' && it ? it.action : null;
            const action = (rawAction && VALID_ACTIONS.has(rawAction)) ? rawAction : (defaultAction && VALID_ACTIONS.has(defaultAction) ? defaultAction : null);
            return { description, action };
          })
          .filter(r => r.description.length > 0)
      : DEFAULT_INFO_REQUEST_STANDARD.map(d => ({ description: d, action: null as string | null }));

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
          create: infoRequestSeed.map((row, i) => ({
            description: row.description,
            isIncluded: true,
            sortOrder: i,
            action: row.action,
          })) as any,
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
        framework: true,
        status: true,
        methodologyVersionId: true,
        isGroupAudit: true,
        isNewClient: true,
        infoRequestType: true,
        createdById: true,
        importOptions: true,
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
