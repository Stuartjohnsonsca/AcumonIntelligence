/**
 * Firm branding / letterhead settings.
 * Stores firm logos, address, regulatory info and the letterhead header/footer
 * wording used by the PDF renderer for client-facing letter templates.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, CONTAINERS, generateSasUrl } from '@/lib/azure-blob';

const EDITABLE_TEXT_FIELDS = [
  'address',
  'phone',
  'email',
  'website',
  'registeredCompanyNumber',
  'statutoryAuditorNumber',
  'legalStatus',
  'registeredOfficeAddress',
  'vatNumber',
  'letterheadHeaderText',
  'letterheadFooterText',
] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firm = await prisma.firm.findUnique({
    where: { id: session.user.firmId },
    select: {
      id: true,
      name: true,
      logoStoragePath: true,
      groupLogoStoragePath: true,
      address: true,
      phone: true,
      email: true,
      website: true,
      registeredCompanyNumber: true,
      statutoryAuditorNumber: true,
      legalStatus: true,
      registeredOfficeAddress: true,
      vatNumber: true,
      letterheadHeaderText: true,
      letterheadFooterText: true,
    },
  });

  if (!firm) return NextResponse.json({ error: 'Firm not found' }, { status: 404 });

  // Generate short-lived SAS URLs for any logos so the settings UI can preview them
  let logoUrl: string | null = null;
  let groupLogoUrl: string | null = null;
  try {
    if (firm.logoStoragePath) logoUrl = generateSasUrl(firm.logoStoragePath, CONTAINERS.INBOX, 60);
  } catch { /* fall through; SAS generation is best-effort for preview */ }
  try {
    if (firm.groupLogoStoragePath) groupLogoUrl = generateSasUrl(firm.groupLogoStoragePath, CONTAINERS.INBOX, 60);
  } catch { /* ditto */ }

  return NextResponse.json({ firm, logoUrl, groupLogoUrl });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, any> = {};

  for (const key of EDITABLE_TEXT_FIELDS) {
    if (body[key] !== undefined) {
      const v = body[key];
      data[key] = v === '' || v === null ? null : String(v);
    }
  }

  await prisma.firm.update({ where: { id: session.user.firmId }, data });
  return NextResponse.json({ success: true });
}

/**
 * POST: upload a logo image.
 * Body: multipart/form-data with `file` and `slot` = "primary" | "group".
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await req.formData();
  const slot = String(formData.get('slot') || 'primary');
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  if (!['primary', 'group'].includes(slot)) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 });
  }

  const mime = file.type || 'application/octet-stream';
  if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(mime)) {
    return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const blobName = `firm-assets/${session.user.firmId}/${slot}-logo-${Date.now()}.${ext}`;

  await uploadToInbox(blobName, buffer, mime);

  const field = slot === 'primary' ? 'logoStoragePath' : 'groupLogoStoragePath';
  await prisma.firm.update({
    where: { id: session.user.firmId },
    data: { [field]: blobName },
  });

  return NextResponse.json({ success: true, slot, storagePath: blobName, container: CONTAINERS.INBOX });
}

/**
 * DELETE: remove a logo reference (primary or group).
 * Query: ?slot=primary | group
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isFirmAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const slot = searchParams.get('slot') || 'primary';
  if (!['primary', 'group'].includes(slot)) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 });
  }

  const field = slot === 'primary' ? 'logoStoragePath' : 'groupLogoStoragePath';
  await prisma.firm.update({
    where: { id: session.user.firmId },
    data: { [field]: null },
  });

  return NextResponse.json({ success: true });
}
