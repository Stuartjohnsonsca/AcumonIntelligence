import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateSasUrl, CONTAINERS } from '@/lib/azure-blob';
import { verifyPortalToken } from '@/lib/specialist-portal-token';

/**
 * Specialist chat attachments — upload + signed-URL fetch.
 *
 *   POST  /api/engagements/:id/specialists/attachments
 *     multipart: file (required), roleKey (required for sig auth),
 *                email + sig (optional — used for external portal
 *                uploads instead of a session)
 *     → { id, name, blobName, mimeType, size, url } where `url`
 *       is a 1-hour SAS link suitable for inline rendering.
 *
 *   GET   /api/engagements/:id/specialists/attachments?blob=<name>&...
 *     query: blob (required), roleKey + email + sig OR a session
 *     → 302 redirect to a fresh SAS URL (links don't expire from
 *       the chat's perspective — every click mints a new short-
 *       lived URL).
 *
 * Uses two auth modes:
 *   - Firm-side users: NextAuth session.
 *   - External specialists: ?email + ?sig (HMAC) tied to the same
 *     engagement+role used by the rest of the External Specialist
 *     Portal API.
 */

interface Ctx { params: Promise<{ engagementId: string }> }

const SCOPE_PREFIX = 'specialists';

async function checkAccess(req: NextRequest, engagementId: string, roleKey: string | null): Promise<{ kind: 'session' | 'portal'; email?: string } | NextResponse> {
  const session = await auth();
  if (session?.user?.twoFactorVerified) {
    // Tenant check — same engagement must belong to the user's firm.
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { firmId: true },
    });
    if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return { kind: 'session' };
  }
  // Fall back to HMAC. Requires roleKey, email, sig. Without those
  // we'd be rejecting an unauth'd request anyway so the error is the
  // same 401 in both cases.
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();
  const sig = url.searchParams.get('sig')?.trim();
  if (!roleKey || !email || !sig) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!verifyPortalToken({ engagementId, roleKey, email }, sig)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { kind: 'portal', email };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { engagementId } = await ctx.params;
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const roleKey = (form.get('roleKey') as string | null) || (new URL(req.url).searchParams.get('roleKey'));
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const access = await checkAccess(req, engagementId, roleKey);
  if (access instanceof NextResponse) return access;

  // Cap at 25MB to stop a misbehaving client from filling blob with
  // a single upload. Same ceiling as the existing /api/upload/document
  // route so the UX is consistent.
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 25 MB)' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobName = `${SCOPE_PREFIX}/${engagementId}/${roleKey || 'unknown'}/${Date.now()}_${safeName}`;
  await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');

  return NextResponse.json({
    id: blobName,
    name: file.name,
    blobName,
    mimeType: file.type || null,
    size: file.size,
    // Short-lived URL the caller can inline immediately; for long-
    // term display use the GET endpoint to mint a fresh SAS each
    // time.
    url: generateSasUrl(blobName, CONTAINERS.INBOX, 60),
  });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { engagementId } = await ctx.params;
  const url = new URL(req.url);
  const blob = url.searchParams.get('blob');
  const roleKey = url.searchParams.get('roleKey');
  if (!blob) return NextResponse.json({ error: 'blob param required' }, { status: 400 });
  // Stop path-traversal — the blob path must start with the
  // engagement scope so a session user can't fetch arbitrary
  // blobs by passing a different prefix.
  if (!blob.startsWith(`${SCOPE_PREFIX}/${engagementId}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const access = await checkAccess(req, engagementId, roleKey);
  if (access instanceof NextResponse) return access;

  // Portal users are additionally constrained to their own role's
  // attachments — they shouldn't be able to grab files from a
  // different role on the same engagement.
  if (access.kind === 'portal' && roleKey && !blob.startsWith(`${SCOPE_PREFIX}/${engagementId}/${roleKey}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sas = generateSasUrl(blob, CONTAINERS.INBOX, 15);
  return NextResponse.redirect(sas);
}
