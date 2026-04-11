import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Plan Customiser — per-engagement overrides to the auto-generated audit plan.
 *
 * Stored on AuditPermanentFile with `sectionKey = 'plan_customiser'` so we
 * don't have to add a new table. The data shape is:
 *
 *   {
 *     overrides: {
 *       [`${testId}__${fsLineId}`]: {
 *         status: 'na',
 *         reasonCategory: string,  // dropdown preset
 *         reason: string,          // free-text
 *         setBy: { id, name },
 *         setAt: string,           // ISO
 *       }
 *     },
 *     customTests: [{
 *       id: 'custom_<uuid>',
 *       name: string,
 *       description: string,
 *       fsLineId: string,
 *       fsLineName: string,
 *       fsNote?: string,
 *       testTypeCode: string,      // default 'human_action'
 *       assertions: string[],
 *       framework: string,
 *       createdBy: { id, name },
 *       createdAt: string,
 *     }]
 *   }
 *
 * Tests marked `n/a` are HIDDEN from AuditPlanPanel's main view (unless the
 * viewer is the Plan Customiser itself, which shows them greyed out so the
 * auditor can see what's been excluded and why). Custom tests appear in the
 * relevant FS Line's test list and execute through the normal flow.
 */

const SECTION_KEY = 'plan_customiser';

export interface PlanCustomiserOverride {
  status: 'na';
  reasonCategory: string;
  reason: string;
  setBy: { id: string; name: string };
  setAt: string;
}

export interface PlanCustomiserCustomTest {
  id: string;
  name: string;
  description: string;
  fsLineId: string;
  fsLineName?: string;
  fsNote?: string;
  testTypeCode: string;
  assertions: string[];
  framework: string;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface PlanCustomiserData {
  overrides: Record<string, PlanCustomiserOverride>;
  customTests: PlanCustomiserCustomTest[];
}

function emptyData(): PlanCustomiserData {
  return { overrides: {}, customTests: [] };
}

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const section = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
  });
  const data = (section?.data as unknown as PlanCustomiserData) || emptyData();
  // Ensure required keys exist for clients that rely on them
  if (!data.overrides) data.overrides = {};
  if (!Array.isArray(data.customTests)) data.customTests = [];
  return NextResponse.json({ data });
}

/**
 * POST mutations:
 *   { action: 'set_na',      testId, fsLineId, reasonCategory, reason }
 *   { action: 'clear_na',    testId, fsLineId }
 *   { action: 'add_custom',  customTest: Omit<PlanCustomiserCustomTest, 'id' | 'createdBy' | 'createdAt'> }
 *   { action: 'remove_custom', id: string }
 *   { action: 'update_custom', id: string, patch: Partial<PlanCustomiserCustomTest> }
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json();
  const { action } = body as { action: string };

  const current = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
  });
  const data: PlanCustomiserData = ((current?.data as unknown as PlanCustomiserData) || emptyData());
  if (!data.overrides) data.overrides = {};
  if (!Array.isArray(data.customTests)) data.customTests = [];

  const setBy = {
    id: session.user.id,
    name: session.user.name || session.user.email || 'Unknown',
  };
  const now = new Date().toISOString();

  switch (action) {
    case 'set_na': {
      const { testId, fsLineId, reasonCategory, reason } = body;
      if (!testId || !fsLineId) {
        return NextResponse.json({ error: 'testId and fsLineId are required' }, { status: 400 });
      }
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return NextResponse.json({ error: 'reason is required' }, { status: 400 });
      }
      const key = `${testId}__${fsLineId}`;
      data.overrides[key] = {
        status: 'na',
        reasonCategory: reasonCategory || 'Other',
        reason: reason.trim(),
        setBy,
        setAt: now,
      };
      break;
    }
    case 'clear_na': {
      const { testId, fsLineId } = body;
      if (!testId || !fsLineId) {
        return NextResponse.json({ error: 'testId and fsLineId are required' }, { status: 400 });
      }
      const key = `${testId}__${fsLineId}`;
      delete data.overrides[key];
      break;
    }
    case 'add_custom': {
      const { customTest } = body as { customTest: Partial<PlanCustomiserCustomTest> };
      if (!customTest?.name || !customTest?.fsLineId) {
        return NextResponse.json({ error: 'name and fsLineId are required' }, { status: 400 });
      }
      const newTest: PlanCustomiserCustomTest = {
        id: `custom_${crypto.randomUUID()}`,
        name: customTest.name,
        description: customTest.description || '',
        fsLineId: customTest.fsLineId,
        fsLineName: customTest.fsLineName,
        fsNote: customTest.fsNote,
        testTypeCode: customTest.testTypeCode || 'human_action',
        assertions: Array.isArray(customTest.assertions) ? customTest.assertions : [],
        framework: customTest.framework || 'IFRS',
        createdBy: setBy,
        createdAt: now,
      };
      data.customTests.push(newTest);
      break;
    }
    case 'remove_custom': {
      const { id } = body;
      data.customTests = data.customTests.filter(t => t.id !== id);
      break;
    }
    case 'update_custom': {
      const { id, patch } = body;
      data.customTests = data.customTests.map(t =>
        t.id === id ? { ...t, ...patch, id: t.id, createdBy: t.createdBy, createdAt: t.createdAt } : t,
      );
      break;
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    create: { engagementId, sectionKey: SECTION_KEY, data: data as unknown as object },
    update: { data: data as unknown as object },
  });

  return NextResponse.json({ data });
}
