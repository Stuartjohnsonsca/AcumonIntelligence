import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { findScheduleAction, renderOpeningMessage } from '@/lib/schedule-actions';

/**
 * Specialists items — server-side helper for creating items in
 * the Specialists tab (PF section `specialists_items`). The tab
 * itself persists user actions client-side; this endpoint is for
 * cases where the engagement runtime needs to create an item on
 * behalf of the user (e.g. when a Schedule Action fires from a
 * triggered answer on a schedule question).
 *
 * POST body shapes:
 *   1. Direct create — full item shape (kind, title, body, etc.)
 *      The endpoint appends it to the role's items list.
 *   2. Schedule-action create — `{ scheduleActionKey, response,
 *      questionText, questionId }`. The endpoint resolves the
 *      action from lib/schedule-actions, renders the opening
 *      message, and creates a chat item under that action's
 *      specialist role.
 *
 * Idempotency: when called with `{ scheduleActionKey, questionId }`
 * we tag the created item with a `sourceQuestionId` and skip
 * duplicate creation if an open item already exists for the same
 * question + action.
 */

const SECTION_KEY = 'specialists_items';

interface SignOffMap { [role: string]: { userId?: string; userName?: string; timestamp?: string } | undefined }
interface SpecialistItem {
  id: string;
  kind: 'chat' | 'report' | 'conclusion';
  title: string;
  createdAt: string;
  createdByName: string;
  body: string;
  messages: any[];
  signOffs: SignOffMap;
  status: 'open' | 'completed';
  // Tag the source question so re-firing the same trigger doesn't
  // duplicate the chat. Only set when the item was created via a
  // Schedule Action.
  sourceQuestionId?: string;
  sourceActionKey?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  const { engagementId } = await params;
  const access = await assertEngagementWriteAccess(engagementId, session);
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 });

  // Schedule-action shape: resolves the action and creates a chat
  // item under its specialist role. Idempotent on (action,
  // question) so a re-fire with the same answer doesn't pile up
  // duplicate chats.
  if (typeof body.scheduleActionKey === 'string') {
    const action = findScheduleAction(body.scheduleActionKey);
    if (!action) return NextResponse.json({ error: 'Unknown scheduleActionKey' }, { status: 400 });

    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    });
    const blob = ((existing?.data ?? {}) as unknown) as Record<string, { items: SpecialistItem[] }>;
    const roleEntry = blob[action.specialistRoleKey] || { items: [] };

    // Idempotency check — if there's already an OPEN chat for
    // this (questionId, actionKey) pair we don't create a new
    // one. Closed chats are exempt (the auditor may want to
    // reopen the conversation after re-answering).
    const questionId = typeof body.questionId === 'string' ? body.questionId : '';
    if (questionId) {
      const dupe = roleEntry.items.find(i =>
        i.sourceQuestionId === questionId &&
        i.sourceActionKey === action.key &&
        i.status === 'open'
      );
      if (dupe) return NextResponse.json({ created: false, item: dupe });
    }

    const opening = renderOpeningMessage(action, {
      questionText: typeof body.questionText === 'string' ? body.questionText : '',
      response: typeof body.response === 'string' ? body.response : '',
    });
    const item: SpecialistItem = {
      id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'chat',
      title: action.label,
      createdAt: new Date().toISOString(),
      createdByName: session?.user?.name || 'System',
      body: opening,
      messages: [],
      signOffs: {},
      status: 'open',
      sourceQuestionId: questionId || undefined,
      sourceActionKey: action.key,
    };
    const nextBlob = {
      ...blob,
      [action.specialistRoleKey]: { items: [...roleEntry.items, item] },
    };
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
      create: { engagementId, sectionKey: SECTION_KEY, data: nextBlob as any },
      update: { data: nextBlob as any },
    });
    return NextResponse.json({ created: true, item });
  }

  // Direct shape: caller supplies the full item. Used by the
  // SpecialistsTab itself when persisting via this endpoint
  // (although today the tab uses /permanent-file directly — kept
  // here for symmetry).
  if (typeof body.roleKey === 'string' && body.item && typeof body.item === 'object') {
    const existing = await prisma.auditPermanentFile.findUnique({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
    });
    const blob = ((existing?.data ?? {}) as unknown) as Record<string, { items: SpecialistItem[] }>;
    const roleEntry = blob[body.roleKey] || { items: [] };
    const item: SpecialistItem = body.item;
    const nextBlob = {
      ...blob,
      [body.roleKey]: { items: [...roleEntry.items, item] },
    };
    await prisma.auditPermanentFile.upsert({
      where: { engagementId_sectionKey: { engagementId, sectionKey: SECTION_KEY } },
      create: { engagementId, sectionKey: SECTION_KEY, data: nextBlob as any },
      update: { data: nextBlob as any },
    });
    return NextResponse.json({ created: true, item });
  }

  return NextResponse.json({ error: 'Provide either scheduleActionKey + question fields, or roleKey + item' }, { status: 400 });
}
