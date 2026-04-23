import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/:engagementId/questionnaires
 *
 * Returns every questionnaire's answers for an engagement, pre-enriched
 * so each answer is reachable by its human-readable question key. Output
 * shape mirrors the template renderer's `questionnaires` branch:
 *
 *   {
 *     questionnaires: {
 *       ethics:         { <key>: value, ... , _byId: { <uuid>: value } },
 *       continuance:    { ... },
 *       permanentFile:  { ... },
 *       materiality:    { ... },
 *       newClientTakeOn:{ ... },
 *       subsequentEvents:{ ... },
 *     },
 *     // Alphabetic appendix aliases pointing at the same objects, so
 *     // admins can cross-ref as either `ethics.foo` or `appendix_b.foo`.
 *     aliases: {
 *       appendix_a: 'permanentFile',
 *       appendix_b: 'ethics',
 *       appendix_c: 'continuance',
 *       appendix_e: 'materiality',
 *     },
 *   }
 *
 * Used by DynamicAppendixForm to resolve per-question `crossRef` paths
 * at render time without pushing this logic down into the context builder
 * (which is server-only).
 */

type Ctx = { params: Promise<{ engagementId: string }> };

/** Canonical schedule key (context key) ← templateType (methodology row). */
const QUESTIONNAIRE_TYPES: Array<{ ctxKey: string; templateType: string; prismaModel: string }> = [
  { ctxKey: 'ethics',            templateType: 'ethics_questions',            prismaModel: 'auditEthics' },
  { ctxKey: 'continuance',       templateType: 'continuance_questions',       prismaModel: 'auditContinuance' },
  { ctxKey: 'permanentFile',     templateType: 'permanent_file_questions',    prismaModel: 'auditPermanentFile' },
  { ctxKey: 'materiality',       templateType: 'materiality_questions',       prismaModel: 'auditMateriality' },
  { ctxKey: 'newClientTakeOn',   templateType: 'new_client_takeon_questions', prismaModel: 'auditNewClientTakeOn' },
  { ctxKey: 'subsequentEvents',  templateType: 'subsequent_events_questions', prismaModel: 'auditSubsequentEvents' },
];

/** Letter-based aliases — align with the Templates.xlsx layout the firm uses. */
const APPENDIX_ALIASES: Record<string, string> = {
  appendix_a: 'permanentFile',
  appendix_b: 'ethics',
  appendix_c: 'continuance',
  appendix_e: 'materiality',
};

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  // Tenancy: engagement must belong to the user's firm (or super-admin).
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Load all firm schemas once. Tolerant: tables/schemas missing → empty data.
  const schemas = await prisma.methodologyTemplate.findMany({
    where: {
      firmId: engagement.firmId,
      templateType: { in: QUESTIONNAIRE_TYPES.map(q => q.templateType) },
    },
  });
  const schemaByType = new Map<string, any[]>();
  for (const s of schemas) {
    schemaByType.set(s.templateType, Array.isArray(s.items) ? (s.items as any[]) : []);
  }

  const questionnaires: Record<string, Record<string, any>> = {};
  await Promise.all(QUESTIONNAIRE_TYPES.map(async (qt) => {
    // Load raw { <uuid>: value } answers.
    let rawData: Record<string, any> = {};
    try {
      const model = (prisma as any)[qt.prismaModel];
      if (model?.findUnique) {
        const row = await model.findUnique({ where: { engagementId } });
        if (row?.data && typeof row.data === 'object') rawData = row.data as Record<string, any>;
      }
    } catch { /* tolerant */ }

    // Enrich with human-readable keys.
    const schema = schemaByType.get(qt.templateType) || [];
    const enriched: Record<string, any> = {};
    const byId: Record<string, any> = { ...rawData };
    for (const item of schema) {
      if (!item?.id) continue;
      const value = rawData[item.id];
      if (value === undefined) continue;
      const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim() : null;
      if (key) enriched[key] = value;
    }
    enriched._byId = byId;
    questionnaires[qt.ctxKey] = enriched;
  }));

  return NextResponse.json({
    questionnaires,
    aliases: APPENDIX_ALIASES,
  });
}
