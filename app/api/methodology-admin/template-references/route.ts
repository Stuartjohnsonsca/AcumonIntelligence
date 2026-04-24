import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractReferencedPaths } from '@/lib/template-handlebars';

/**
 * GET /api/methodology-admin/template-references
 *
 * Returns every Handlebars path referenced by any of the firm's
 * active document + email templates (content + subject). Powers the
 * red "this cell feeds a template" highlight on schedule forms —
 * DynamicAppendixForm fetches this once on mount, and every question
 * whose placeholder path appears in the set gets a red outline on
 * the answer cell.
 *
 * Response:
 *   {
 *     paths: string[],                 // unique dotted paths referenced
 *     byPath: {
 *       [path]: Array<{ templateId, templateName, kind }>
 *     },
 *   }
 *
 * Auth: any authenticated user — schedules are seen by the whole
 * audit team and the red highlight is a read-only hint, not a
 * privileged action.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const firmId = session.user.firmId;

  const templates = await prisma.documentTemplate.findMany({
    where: { firmId, isActive: true },
    select: { id: true, name: true, kind: true, subject: true, content: true },
  });

  const paths = new Set<string>();
  const byPath: Record<string, Array<{ templateId: string; templateName: string; kind: string }>> = {};

  for (const t of templates) {
    const refs = new Set<string>();
    try {
      for (const p of extractReferencedPaths(t.content || '')) refs.add(p);
      for (const p of extractReferencedPaths(t.subject || '')) refs.add(p);
    } catch {
      // Malformed template shouldn't break the list.
      continue;
    }
    for (const p of refs) {
      paths.add(p);
      if (!byPath[p]) byPath[p] = [];
      byPath[p].push({ templateId: t.id, templateName: t.name, kind: t.kind });
    }
  }

  return NextResponse.json({
    paths: [...paths].sort(),
    byPath,
  });
}
