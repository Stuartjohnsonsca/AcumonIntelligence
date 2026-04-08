import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true, clientId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// Helper: get/set permanent file data by sectionKey
async function getData(engagementId: string, sectionKey: string) {
  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey } },
  });
  return (row?.data as Record<string, unknown>) || {};
}

async function setData(engagementId: string, sectionKey: string, data: Record<string, unknown>) {
  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey } },
    create: { engagementId, sectionKey, data: data as object },
    update: { data: data as object },
  });
}

// GET — returns all significant risks with memo data
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 1. Get all RMM rows that are significant risks
  const rmmRows = await prisma.auditRMMRow.findMany({
    where: { engagementId, overallRisk: { in: ['High', 'Very High'] } },
    orderBy: { sortOrder: 'asc' },
  });

  // 2. Get supplementary data
  const [conclusions, specialists, teamMembers, walkthroughRequests] = await Promise.all([
    prisma.auditTestConclusion.findMany({ where: { engagementId } }),
    prisma.auditSpecialist.findMany({ where: { engagementId } }),
    prisma.auditTeamMember.findMany({ where: { engagementId }, include: { user: { select: { name: true } } } }),
    prisma.portalRequest.findMany({
      where: { engagementId, section: 'walkthroughs', status: { in: ['responded', 'verified'] } },
    }),
  ]);

  // 3. For each sig risk, load memo data and auto-populate
  const memos = await Promise.all(rmmRows.map(async (row) => {
    const memoData = await getData(engagementId, `srmm_${row.id}`);
    const signOffs = await getData(engagementId, `srmm_${row.id}_signoffs`);

    // Auto-populate fields from engagement data
    const matchingConclusions = conclusions.filter(c =>
      c.fsLine === row.lineItem || c.fsLine === row.fsLevel
    );
    const matchingWalkthroughs = walkthroughRequests.filter(w =>
      (w.question || '').toLowerCase().includes((row.lineItem || '').toLowerCase())
    );

    return {
      rmmRowId: row.id,
      // RMM row data
      lineItem: row.lineItem,
      riskIdentified: row.riskIdentified,
      aiSummary: row.aiSummary,
      assertions: row.assertions,
      overallRisk: row.overallRisk,
      likelihood: row.likelihood,
      magnitude: row.magnitude,
      controlRisk: row.controlRisk,
      complexityText: row.complexityText,
      subjectivityText: row.subjectivityText,
      uncertaintyText: row.uncertaintyText,
      changeText: row.changeText,
      susceptibilityText: row.susceptibilityText,
      fsStatement: row.fsStatement,
      fsLevel: row.fsLevel,
      // Auto-populated
      autoPop: {
        testConclusions: matchingConclusions.map(c => ({
          testDescription: c.testDescription,
          conclusion: c.conclusion,
          populationSize: c.populationSize,
          sampleSize: c.sampleSize,
          totalErrors: c.totalErrors,
          auditorNotes: c.auditorNotes,
          status: c.status,
        })),
        walkthroughs: matchingWalkthroughs.map(w => ({
          question: w.question,
          response: w.response,
          status: w.status,
          respondedAt: w.respondedAt,
        })),
        specialists: specialists.map(s => ({
          name: s.name,
          specialistType: s.specialistType,
          firmName: s.firmName,
          email: s.email,
        })),
      },
      // Saved memo content
      memo: memoData,
      signOffs,
    };
  }));

  return NextResponse.json({
    memos,
    team: teamMembers.map(m => ({ userId: m.userId, userName: m.user?.name, role: m.role })),
  });
}

// POST — save memo, sign off, export
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const { action } = body;

  // Save memo content
  if (action === 'save') {
    const { rmmRowId, data } = body;
    if (!rmmRowId) return NextResponse.json({ error: 'rmmRowId required' }, { status: 400 });
    await setData(engagementId, `srmm_${rmmRowId}`, data || {});
    return NextResponse.json({ success: true });
  }

  // Sign off / unsign off
  if (action === 'signoff' || action === 'unsignoff') {
    const { rmmRowId, role } = body;
    if (!rmmRowId || !role) return NextResponse.json({ error: 'rmmRowId and role required' }, { status: 400 });
    const key = `srmm_${rmmRowId}_signoffs`;
    const signOffs = await getData(engagementId, key);

    if (action === 'unsignoff') {
      delete signOffs[role];
    } else {
      signOffs[role] = {
        userId: session.user.id,
        userName: session.user.name || session.user.email,
        timestamp: new Date().toISOString(),
      };
    }
    await setData(engagementId, key, signOffs);
    return NextResponse.json({ signOffs });
  }

  // Generate DOCX
  if (action === 'generate_docx') {
    const { rmmRowId } = body;
    if (!rmmRowId) return NextResponse.json({ error: 'rmmRowId required' }, { status: 400 });

    const rmmRow = await prisma.auditRMMRow.findUnique({ where: { id: rmmRowId } });
    if (!rmmRow) return NextResponse.json({ error: 'RMM row not found' }, { status: 404 });

    const memoData = await getData(engagementId, `srmm_${rmmRowId}`);
    const signOffs = await getData(engagementId, `srmm_${rmmRowId}_signoffs`);

    // Get engagement details for header
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      include: {
        client: { select: { companyName: true } },
        period: { select: { endDate: true } },
      },
    });

    try {
      const { generateSRMMMemo } = await import('@/lib/srmm-docx');
      const buffer = await generateSRMMMemo({
        clientName: engagement?.client?.companyName || 'Unknown',
        periodEnd: engagement?.period?.endDate ? new Date(engagement.period.endDate).toLocaleDateString('en-GB') : '',
        rmmRow: {
          lineItem: rmmRow.lineItem,
          riskIdentified: rmmRow.riskIdentified,
          assertions: rmmRow.assertions as string[] || [],
          controlRisk: rmmRow.controlRisk,
          complexityText: rmmRow.complexityText,
          subjectivityText: rmmRow.subjectivityText,
          uncertaintyText: rmmRow.uncertaintyText,
        },
        memo: memoData,
        signOffs,
      });

      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="SRMM_${rmmRow.lineItem.replace(/[^a-zA-Z0-9]/g, '_')}.docx"`,
        },
      });
    } catch (err: any) {
      console.error('[SRMM] DOCX generation failed:', err);
      return NextResponse.json({ error: err.message || 'DOCX generation failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
