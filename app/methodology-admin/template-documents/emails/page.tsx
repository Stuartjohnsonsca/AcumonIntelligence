import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TemplateDocumentsClient } from '@/components/methodology-admin/TemplateDocumentsClient';

export default async function EmailTemplatesPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/template-documents/emails');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  let templates: any[] = [];
  let categories: { value: string; label: string }[] | undefined;

  try {
    templates = await prisma.documentTemplate.findMany({
      where: { firmId: session.user.firmId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    // Serialize dates
    templates = templates.map((t: any) => ({
      ...t,
      createdAt: t.createdAt?.toISOString() ?? null,
      updatedAt: t.updatedAt?.toISOString() ?? null,
    }));
  } catch {
    // Table may not exist yet
  }

  // Load admin-managed categories
  try {
    const catRecord = await prisma.methodologyTemplate.findUnique({
      where: {
        firmId_templateType_auditType: {
          firmId: session.user.firmId,
          templateType: 'email_template_categories',
          auditType: 'ALL',
        },
      },
    });
    if (catRecord?.items && Array.isArray(catRecord.items)) {
      categories = catRecord.items as { value: string; label: string }[];
    }
  } catch {
    // Fall back to defaults
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <TemplateDocumentsClient initialTemplates={templates} initialCategories={categories} />
    </div>
  );
}
