import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob, generateSasUrl } from '@/lib/azure-blob';

/**
 * Per-skeleton endpoints.
 *
 *   GET ?download=1  → redirects the browser to a short-lived SAS URL
 *                      for the .docx. Without `?download=1` returns the
 *                      metadata row as JSON.
 *   PATCH            → rename / set-default / deactivate.
 *   DELETE           → soft-delete (isActive=false). The blob is kept
 *                      so historical renders can still be audited.
 *
 * Auth: superAdmin || methodologyAdmin, scoped to their own firm
 * (a superAdmin can manage any firm's skeletons by convention but we
 * still scope by firmId for tenant safety unless the user is super).
 */

type Ctx = { params: Promise<{ id: string }> };

async function gate(id: string): Promise<{ error: string; status: 401 | 403 | 404 } | { session: any; row: any }> {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return { error: 'Unauthorized', status: 401 };
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) return { error: 'Forbidden', status: 403 };
  const row = await prisma.firmDocumentSkeleton.findUnique({ where: { id } });
  if (!row) return { error: 'Not found', status: 404 };
  if (!session.user.isSuperAdmin && row.firmId !== session.user.firmId) return { error: 'Forbidden', status: 403 };
  return { session, row };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const check = await gate(id);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });
  const { row } = check;

  const wantsDownload = new URL(req.url).searchParams.get('download') === '1';
  if (!wantsDownload) return NextResponse.json({ skeleton: row });

  // Prefer a SAS redirect (no server bandwidth) but fall back to
  // streaming the buffer if Azure credentials don't support SAS.
  try {
    const sas = generateSasUrl(row.storagePath, row.containerName, 10);
    return NextResponse.redirect(sas, 302);
  } catch {
    const buf = await downloadBlob(row.storagePath, row.containerName);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': row.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${row.originalFileName}"`,
      },
    });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const check = await gate(id);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });
  const { row } = check;
  const body = await req.json();
  const data: Record<string, any> = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (typeof body.description === 'string') data.description = body.description.trim() || null;
  if (typeof body.auditType === 'string') data.auditType = body.auditType;
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  if (typeof body.isDefault === 'boolean') {
    data.isDefault = body.isDefault;
    // When promoting to default, demote siblings on the same audit type.
    if (body.isDefault) {
      await prisma.firmDocumentSkeleton.updateMany({
        where: { firmId: row.firmId, auditType: data.auditType ?? row.auditType, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
  }
  const skeleton = await prisma.firmDocumentSkeleton.update({ where: { id }, data });
  return NextResponse.json({ skeleton });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const check = await gate(id);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });
  await prisma.firmDocumentSkeleton.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
