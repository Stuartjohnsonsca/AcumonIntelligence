import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  defaultIndependenceRefreshRules,
  type IndependenceRefreshDaysRule,
} from '@/lib/independence';

/**
 * Firm-Wide Independence Refresh Cadence.
 *
 * Stored as one MethodologyTemplate row:
 *   firmId / templateType='independence_refresh_days' / auditType='ALL'
 *   items = IndependenceRefreshDaysRule[]
 *
 * An "ALL" row (permanent default) is ALWAYS present. Zero or more
 * audit-type overrides can be added/removed. `days` must be a positive
 * integer — we clamp silently on save.
 */

const TEMPLATE_KEY = { templateType: 'independence_refresh_days', auditType: 'ALL' as const };

function sanitise(list: unknown): IndependenceRefreshDaysRule[] {
  if (!Array.isArray(list)) return defaultIndependenceRefreshRules();
  const seen = new Set<string>();
  const cleaned: IndependenceRefreshDaysRule[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as any;
    const auditType = String(r.auditType || '').trim();
    const daysRaw = Number(r.days);
    if (!auditType || seen.has(auditType)) continue;
    const days = Math.max(1, Math.floor(Number.isFinite(daysRaw) ? daysRaw : 30));
    seen.add(auditType);
    cleaned.push({ auditType, days });
  }
  // Guarantee the ALL default is present.
  if (!cleaned.some(r => r.auditType === 'ALL')) {
    cleaned.unshift({ auditType: 'ALL', days: 30 });
  }
  return cleaned;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firmId = session.user.firmId;
  const row = await prisma.methodologyTemplate.findUnique({
    where: { firmId_templateType_auditType: { firmId, ...TEMPLATE_KEY } },
  }).catch(() => null);
  const rules: IndependenceRefreshDaysRule[] = row && Array.isArray(row.items)
    ? sanitise(row.items as any)
    : defaultIndependenceRefreshRules();
  return NextResponse.json({ rules });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firmId = session.user.firmId;
  const body = await req.json().catch(() => ({}));
  const rules = sanitise(body.rules);

  await prisma.methodologyTemplate.upsert({
    where: { firmId_templateType_auditType: { firmId, ...TEMPLATE_KEY } },
    create: { firmId, ...TEMPLATE_KEY, items: rules as any },
    update: { items: rules as any },
  });
  return NextResponse.json({ ok: true, rules });
}
