import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPortalHubToken, signPortalToken } from '@/lib/specialist-portal-token';

/**
 * Specialist Hub — cross-engagement view for an external specialist.
 *
 *   GET  /api/specialist-portal/hub?email=&sig=
 *     → every (engagement, roleKey) pair this email has access to,
 *       with the items under each, status pre-computed (open /
 *       closed / responded / unresponded), date initiated and last
 *       message date so the client can sort + filter without doing
 *       a second round-trip.
 *
 *   POST /api/specialist-portal/hub?email=&sig=
 *     body: { engagementId, roleKey, itemId, message,
 *             attachments?, callLink? }
 *     → appends a message to the matching chat. Verifies that the
 *       email actually has access to (engagementId, roleKey) before
 *       writing, even though the hub signature is engagement-agnostic.
 *
 * Auth: HMAC over `hub|<email>` only. The signature proves the
 * specialist holds the link the auditor mailed; per-engagement
 * access checks live below.
 */

const SECTION_KEY = 'specialists_items';

interface ChatAttachment {
  id: string;
  name: string;
  blobName?: string;
  mimeType?: string | null;
  size?: number;
}
interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  role: string;
  message: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  callLink?: { label?: string; url: string };
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

function readHubAuth(req: NextRequest): { email: string } | null {
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();
  const sig = url.searchParams.get('sig')?.trim();
  if (!email || !sig) return null;
  if (!verifyPortalHubToken(email, sig)) return null;
  return { email };
}

/**
 * Per-item status the client uses to filter the chat list.
 *   closed       — item.status === 'completed'
 *   responded    — open and the last message was from THIS specialist
 *                  (back with the team, no action needed from them)
 *   unresponded  — open and either no messages or the last message
 *                  was NOT from this specialist (waiting on them)
 */
function computeItemStatus(item: SpecialistItem, email: string): 'closed' | 'responded' | 'unresponded' {
  if (item.status === 'completed') return 'closed';
  const last = item.messages.length > 0 ? item.messages[item.messages.length - 1] : null;
  if (!last) return 'unresponded';
  // Portal posts tag userId as `external:<email>`. Some legacy
  // messages just used userName so check both.
  const lastIsFromMe =
    (last.userId || '').toLowerCase() === `external:${email}` ||
    (last.userName || '').toLowerCase() === email ||
    (last.role || '').toLowerCase() === 'external specialist';
  return lastIsFromMe ? 'responded' : 'unresponded';
}

/** Last message timestamp, falling back to item.createdAt when no messages. */
function lastMessageAt(item: SpecialistItem): string {
  if (item.messages.length === 0) return item.createdAt;
  return item.messages[item.messages.length - 1].createdAt || item.createdAt;
}

/**
 * Decide whether `email` should be allowed to see this role's chats
 * on this engagement. True when ANY of:
 *   1. An AuditSpecialist row on this engagement has matching email
 *      AND its specialistType equals the chat-blob roleKey.
 *   2. The chat blob under this roleKey already has at least one
 *      item with a message from `external:<email>` (this catches
 *      historical chats where the specialist participated even if
 *      they weren't formally assigned to the role on this engagement).
 *   3. The firm's `specialist_roles` config has this email as the
 *      lead OR a member of the matching role key.
 */
function emailHasAccess(
  email: string,
  roleKey: string,
  items: SpecialistItem[],
  engagementSpecialists: Array<{ specialistType: string; email: string | null }>,
  firmRole: { name?: string; email?: string; members?: Array<{ email?: string }> } | undefined,
): boolean {
  const lower = email.toLowerCase();
  if (engagementSpecialists.some(s => (s.specialistType === roleKey) && (s.email || '').toLowerCase() === lower)) {
    return true;
  }
  for (const item of items) {
    for (const m of item.messages) {
      const u = (m.userId || '').toLowerCase();
      const n = (m.userName || '').toLowerCase();
      if (u === `external:${lower}` || n === lower) return true;
    }
  }
  if (firmRole) {
    if ((firmRole.email || '').toLowerCase() === lower) return true;
    if (Array.isArray(firmRole.members)) {
      for (const m of firmRole.members) {
        if ((m?.email || '').toLowerCase() === lower) return true;
      }
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  const auth = readHubAuth(req);
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const email = auth.email;

  // Pull every permanent-file 'specialists_items' row across the
  // whole platform — yes, cross-firm. We then filter per role using
  // emailHasAccess(), which guarantees we only return items where
  // THIS email has either an assignment, an existing chat, or a
  // firm-role membership. Without this cross-firm scan, a specialist
  // bouncing between firms would need a different hub URL per firm.
  const sections = await prisma.auditPermanentFile.findMany({
    where: { sectionKey: SECTION_KEY },
    select: {
      engagementId: true,
      data: true,
      engagement: {
        select: {
          id: true,
          firmId: true,
          auditType: true,
          client: { select: { id: true, clientName: true } },
          period: { select: { id: true, startDate: true, endDate: true } },
          specialists: { select: { specialistType: true, email: true } },
        },
      },
    },
  });

  // For each engagement's firm we need the specialist_roles config
  // (so we can apply rule 3 of emailHasAccess). Fetch unique firmIds
  // in one batch.
  const firmIds = Array.from(new Set(sections.map(s => s.engagement?.firmId).filter(Boolean) as string[]));
  const firmRoleRows = firmIds.length > 0 ? await prisma.methodologyTemplate.findMany({
    where: {
      firmId: { in: firmIds },
      templateType: 'specialist_roles',
      auditType: 'ALL',
    },
    select: { firmId: true, items: true },
  }) : [];
  const firmRolesByFirmId = new Map<string, any[]>();
  for (const r of firmRoleRows) {
    firmRolesByFirmId.set(r.firmId, Array.isArray(r.items) ? (r.items as any[]) : []);
  }

  const baseUrl = (process.env.NEXTAUTH_URL || 'https://acumon-website.vercel.app').replace(/\/+$/, '');

  const items: Array<{
    engagementId: string;
    clientId: string;
    clientName: string;
    periodId: string | null;
    periodStartDate: string | null;
    periodEndDate: string | null;
    auditType: string;
    roleKey: string;
    roleLabel: string;
    item: SpecialistItem;
    status: 'closed' | 'responded' | 'unresponded';
    initiatedAt: string;
    lastMessageAt: string;
    /** Deep-link to the original per-engagement portal URL — useful
     *  when the specialist needs the engagement-locked view (e.g.
     *  for attachments handled by the per-engagement endpoint). */
    deepLink: string;
  }> = [];

  for (const s of sections) {
    if (!s.engagement) continue;
    const eng = s.engagement;
    const blob = ((s.data ?? {}) as unknown) as Record<string, { items?: SpecialistItem[] } | undefined>;
    const firmRoles = firmRolesByFirmId.get(eng.firmId) || [];
    for (const [roleKey, roleEntry] of Object.entries(blob)) {
      if (!roleEntry || !Array.isArray(roleEntry.items)) continue;
      const roleItems = roleEntry.items;
      const firmRole = firmRoles.find(r => r?.key === roleKey);
      if (!emailHasAccess(email, roleKey, roleItems, eng.specialists || [], firmRole)) continue;
      const roleLabel = (firmRole?.label && String(firmRole.label).trim()) || roleKey.replace(/_/g, ' ');
      for (const item of roleItems) {
        const status = computeItemStatus(item, email);
        items.push({
          engagementId: eng.id,
          clientId: eng.client?.id || '',
          clientName: eng.client?.clientName || '',
          periodId: eng.period?.id || null,
          periodStartDate: eng.period?.startDate?.toISOString() || null,
          periodEndDate: eng.period?.endDate?.toISOString() || null,
          auditType: eng.auditType,
          roleKey,
          roleLabel,
          item,
          status,
          initiatedAt: item.createdAt,
          lastMessageAt: lastMessageAt(item),
          deepLink: (() => {
            const sig = signPortalToken({ engagementId: eng.id, roleKey, email });
            const u = new URL(`${baseUrl}/specialist-portal/${encodeURIComponent(eng.id)}/${encodeURIComponent(roleKey)}`);
            u.searchParams.set('email', email);
            u.searchParams.set('sig', sig);
            return u.toString();
          })(),
        });
      }
    }
  }

  // Newest-first by last message — the typical "what needs my
  // attention" sort order. Client can re-sort.
  items.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));

  return NextResponse.json({
    email,
    items,
    /** Distinct (clientId, clientName) pairs for the dropdown. */
    clients: Array.from(
      items.reduce((m, it) => {
        if (it.clientId && !m.has(it.clientId)) m.set(it.clientId, it.clientName);
        return m;
      }, new Map<string, string>()).entries(),
    ).map(([id, name]) => ({ id, name })),
  });
}

export async function POST(req: NextRequest) {
  const auth = readHubAuth(req);
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const email = auth.email;

  const body = await req.json().catch(() => null);
  const engagementId = String(body?.engagementId || '').trim();
  const roleKey = String(body?.roleKey || '').trim();
  const itemId = String(body?.itemId || '').trim();
  const message = String(body?.message || '').trim();
  const attachments: ChatAttachment[] = Array.isArray(body?.attachments)
    ? body.attachments
        .filter((a: any) => a && typeof a === 'object' && a.id && a.name)
        .map((a: any) => ({
          id: String(a.id),
          name: String(a.name),
          blobName: a.blobName ? String(a.blobName) : undefined,
          mimeType: a.mimeType ?? null,
          size: typeof a.size === 'number' ? a.size : undefined,
        }))
    : [];
  const callLink = body?.callLink && typeof body.callLink === 'object' && typeof body.callLink.url === 'string' && /^https?:\/\//i.test(body.callLink.url)
    ? { url: String(body.callLink.url), label: body.callLink.label ? String(body.callLink.label) : undefined }
    : undefined;
  if (!engagementId || !roleKey || !itemId || (!message && attachments.length === 0 && !callLink)) {
    return NextResponse.json({ error: 'engagementId, roleKey, itemId and at least a message, attachment, or callLink are required' }, { status: 400 });
  }

  // Re-derive access for this specific engagement+role to make sure
  // the hub signature isn't being used to talk to an engagement the
  // specialist has no business in.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      firmId: true,
      specialists: { select: { specialistType: true, email: true } },
    },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  const section = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
  });
  if (!section) return NextResponse.json({ error: 'No specialist items yet' }, { status: 404 });
  const blob = ((section.data ?? {}) as unknown) as Record<string, { items: SpecialistItem[] }>;
  const role = blob[roleKey];
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

  const firmRolesRow = await prisma.methodologyTemplate.findUnique({
    where: { firmId_templateType_auditType: { firmId: engagement.firmId, templateType: 'specialist_roles', auditType: 'ALL' } },
    select: { items: true },
  });
  const firmRoles = Array.isArray(firmRolesRow?.items) ? (firmRolesRow!.items as any[]) : [];
  const firmRole = firmRoles.find(r => r?.key === roleKey);
  if (!emailHasAccess(email, roleKey, role.items, engagement.specialists || [], firmRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const idx = role.items.findIndex(i => i.id === itemId);
  if (idx < 0) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  if (role.items[idx].status !== 'open') {
    return NextResponse.json({ error: 'Item is not open for messages' }, { status: 409 });
  }

  const newMessage: ChatMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: `external:${email}`,
    userName: email,
    role: 'External Specialist',
    message,
    createdAt: new Date().toISOString(),
    attachments: attachments.length > 0 ? attachments : undefined,
    callLink,
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
