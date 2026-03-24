import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Shared sign-off handler for any tab that stores data in a JSON model.
 * Handles:
 *   GET ?meta=signoffs → returns sign-offs and field meta
 *   POST { action: 'signoff', role } → records sign-off after role verification
 *   PUT { fieldMeta } → saves field edit timestamps alongside data
 */

const SIGNOFF_SECTION_KEY = '__signoffs';
const FIELDMETA_SECTION_KEY = '__fieldmeta';

interface SignOffParams {
  engagementId: string;
  userId: string;
  userName: string;
  role: string; // 'operator' | 'reviewer' | 'partner'
}

// Role map: sign-off role → team role in DB
const ROLE_MAP: Record<string, string> = {
  operator: 'Junior',
  reviewer: 'Manager',
  partner: 'RI',
};

/**
 * Verify the user holds the required team role for sign-off.
 */
export async function verifySignOffRole(engagementId: string, userId: string, signOffRole: string): Promise<boolean> {
  const teamRole = ROLE_MAP[signOffRole];
  if (!teamRole) return false;
  const member = await prisma.auditTeamMember.findFirst({
    where: { engagementId, userId, role: teamRole },
  });
  return !!member;
}

/**
 * Handle sign-off for AuditPermanentFile (sectionKey-based storage).
 * Used by permanent-file tab.
 */
export async function handlePermanentFileSignOff(engagementId: string, params: SignOffParams, sectionKeySuffix?: string) {
  const allowed = await verifySignOffRole(engagementId, params.userId, params.role);
  if (!allowed) {
    return NextResponse.json({ error: `You must be assigned as ${params.role} to sign off` }, { status: 403 });
  }

  const signoffKey = sectionKeySuffix ? `${SIGNOFF_SECTION_KEY}_${sectionKeySuffix}` : SIGNOFF_SECTION_KEY;

  const existing = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: signoffKey } },
  });

  const signOffs = (existing?.data || {}) as Record<string, unknown>;
  signOffs[params.role] = {
    userId: params.userId,
    userName: params.userName,
    timestamp: new Date().toISOString(),
  };

  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: signoffKey } },
    create: { engagementId, sectionKey: signoffKey, data: signOffs as object },
    update: { data: signOffs as object },
  });

  return NextResponse.json({ signOffs });
}

/**
 * Get sign-offs from AuditPermanentFile sectionKey storage.
 */
export async function getPermanentFileSignOffs(engagementId: string, sectionKeySuffix?: string) {
  const signoffKey = sectionKeySuffix ? `${SIGNOFF_SECTION_KEY}_${sectionKeySuffix}` : SIGNOFF_SECTION_KEY;
  const metaKey = sectionKeySuffix ? `${FIELDMETA_SECTION_KEY}_${sectionKeySuffix}` : FIELDMETA_SECTION_KEY;

  const [signOffRec, metaRec] = await Promise.all([
    prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: signoffKey } },
    }),
    prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: metaKey } },
    }),
  ]);

  return NextResponse.json({
    signOffs: signOffRec?.data || {},
    fieldMeta: metaRec?.data || {},
  });
}

/**
 * Save field meta into AuditPermanentFile sectionKey storage.
 */
export async function savePermanentFileFieldMeta(engagementId: string, fieldMeta: Record<string, unknown>, sectionKeySuffix?: string) {
  const metaKey = sectionKeySuffix ? `${FIELDMETA_SECTION_KEY}_${sectionKeySuffix}` : FIELDMETA_SECTION_KEY;

  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey: metaKey } },
    create: { engagementId, sectionKey: metaKey, data: fieldMeta as object },
    update: { data: fieldMeta as object },
  });
}

/**
 * Handle sign-off for single-record JSON tables (Ethics, Continuance, Materiality, etc.)
 * Sign-offs stored inside data.__signoffs and field meta in data.__fieldmeta.
 */
export async function handleJsonTableSignOff(
  model: any,
  engagementId: string,
  params: SignOffParams,
) {
  const allowed = await verifySignOffRole(engagementId, params.userId, params.role);
  if (!allowed) {
    return NextResponse.json({ error: `You must be assigned as ${params.role} to sign off` }, { status: 403 });
  }

  let record = await model.findUnique({ where: { engagementId } });

  const data = (record?.data || {}) as Record<string, unknown>;
  const signOffs = (data.__signoffs || {}) as Record<string, unknown>;
  signOffs[params.role] = {
    userId: params.userId,
    userName: params.userName,
    timestamp: new Date().toISOString(),
  };
  data.__signoffs = signOffs;

  if (record) {
    await model.update({ where: { id: record.id }, data: { data: data as object } });
  } else {
    await model.create({ data: { engagementId, data: data as object } });
  }

  return NextResponse.json({ signOffs });
}

/**
 * Get sign-offs from a single-record JSON table.
 */
export async function getJsonTableSignOffs(model: any, engagementId: string) {
  const record = await model.findUnique({ where: { engagementId } });
  const data = (record?.data || {}) as Record<string, unknown>;

  return NextResponse.json({
    signOffs: data.__signoffs || {},
    fieldMeta: data.__fieldmeta || {},
  });
}

/**
 * Save field meta into a single-record JSON table.
 */
export async function saveJsonTableFieldMeta(model: any, engagementId: string, fieldMeta: Record<string, unknown>) {
  let record = await model.findUnique({ where: { engagementId } });
  const data = (record?.data || {}) as Record<string, unknown>;
  data.__fieldmeta = fieldMeta;

  if (record) {
    await model.update({ where: { id: record.id }, data: { data: data as object } });
  } else {
    await model.create({ data: { engagementId, data: data as object } });
  }
}
