import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/fix-framework-dropdown
 * Updates the permanent file template to make "Applicable financial reporting framework"
 * a dropdown instead of textarea. Run once.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const templates = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId, templateType: 'permanent_file' },
  });

  let updated = 0;
  for (const tmpl of templates) {
    const items = tmpl.items as any[];
    if (!Array.isArray(items)) continue;

    let changed = false;
    for (const item of items) {
      if (
        item.questionText?.toLowerCase().includes('applicable financial reporting framework') &&
        item.inputType !== 'dropdown'
      ) {
        item.inputType = 'dropdown';
        item.dropdownOptions = ['IFRS', 'FRS102', 'FRS101', 'FRS105', 'Charities'];
        changed = true;
      }
    }

    if (changed) {
      await prisma.methodologyTemplate.update({
        where: { id: tmpl.id },
        data: { items },
      });
      updated++;
    }
  }

  return NextResponse.json({ message: `Updated ${updated} template(s)`, updated });
}
