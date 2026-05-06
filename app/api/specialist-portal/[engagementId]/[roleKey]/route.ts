import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPortalToken } from '@/lib/specialist-portal-token';

/**
 * External Specialist Portal API. No firm-side session — the
 * email + sig query parameters are the auth.
 *
 *   GET  /api/specialist-portal/:engagementId/:roleKey?email=&sig=
 *     → engagement metadata + chat items for that role
 *   POST /api/specialist-portal/:engagementId/:roleKey?email=&sig=
 *     body: { itemId, message }
 *     → appends a message to the matching chat item
 *
 * Returns 403 on any signature mismatch (timing-safe comparison
 * inside verifyPortalToken).
 */

const SECTION_KEY = 'specialists_items';

interface Ctx { params: Promise<{ engagementId: string; roleKey: string }> }

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  role: string;
  message: string;
  createdAt: string;
  attachments?: { id: string; name: string; url?: string }[];
}

interface SpecialistItem {
  id: string;
  kind: 'chat' | 'report' | 'conclusion';
  title: string;
  createdAt: string;
  createdByName: string;
  body: string;
  messages: ChatMessage[];
  signOffs: any;
  status: 'open' | 'completed';
  sourceQuestionId?: string;
  sourceActionKey?: string;
}

function readAuth(req: NextRequest, engagementId: string, roleKey: string): { email: string } | null {
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();
  const sig = url.searchParams.get('sig')?.trim();
  if (!email || !sig) return null;
  if (!verifyPortalToken({ engagementId, roleKey, email }, sig)) return null;
  return { email };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { engagementId, roleKey } = await ctx.params;
  const auth = readAuth(req, engagementId, roleKey);
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Engagement context (client name + period end) — what the
  // specialist needs to confirm they're looking at the right file.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      id: true,
      auditType: true,
      client: { select: { clientName: true } },
      period: { select: { endDate: true } },
    },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  const section = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    select: { data: true },
  });
  const blob = ((section?.data ?? {}) as unknown) as Record<string, { items?: SpecialistItem[] } | undefined>;
  const items = blob[roleKey]?.items || [];

  return NextResponse.json({
    engagement: {
      id: engagement.id,
      auditType: engagement.auditType,
      clientName: engagement.client.clientName,
      periodEnd: engagement.period?.endDate?.toISOString() || null,
    },
    roleKey,
    email: auth.email,
    items,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { engagementId, roleKey } = await ctx.params;
  const auth = readAuth(req, engagementId, roleKey);
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const itemId = String(body?.itemId || '').trim();
  const message = String(body?.message || '').trim();
  if (!itemId || !message) {
    return NextResponse.json({ error: 'itemId and message required' }, { status: 400 });
  }

  const section = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
  });
  if (!section) return NextResponse.json({ error: 'No specialist items yet' }, { status: 404 });
  const blob = ((section.data ?? {}) as unknown) as Record<string, { items: SpecialistItem[] }>;
  const role = blob[roleKey];
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  const idx = role.items.findIndex(i => i.id === itemId);
  if (idx < 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  if (role.items[idx].status !== 'open') {
    return NextResponse.json({ error: 'Item is not open for messages' }, { status: 409 });
  }

  const newMessage: ChatMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: `external:${auth.email}`,
    userName: auth.email,
    role: 'External Specialist',
    message,
    createdAt: new Date().toISOString(),
  };
  const next: SpecialistItem = {
    ...role.items[idx],
    messages: [...role.items[idx].messages, newMessage],
  };
  const nextItems = role.items.slice();
  nextItems[idx] = next;
  const nextBlob = { ...blob, [roleKey]: { items: nextItems } };

  await prisma.auditPermanentFile.update({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    data: { data: nextBlob as any },
  });

  return NextResponse.json({ ok: true, message: newMessage });
}
