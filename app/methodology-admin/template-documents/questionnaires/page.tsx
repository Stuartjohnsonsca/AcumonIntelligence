import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { QuestionnaireManagerClient } from '@/components/methodology-admin/QuestionnaireManagerClient';

export default async function QuestionnairesPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/template-documents/questionnaires');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  // Load questionnaires from MethodologyTemplate where templateType = 'questionnaire'
  let questionnaires: any[] = [];
  try {
    const records = await prisma.methodologyTemplate.findMany({
      where: { firmId: session.user.firmId, templateType: 'questionnaire' },
      orderBy: { createdAt: 'desc' },
    });
    questionnaires = records.map((r: any) => ({
      id: r.id,
      auditType: r.auditType,
      ...(typeof r.items === 'object' && r.items !== null ? r.items : {}),
      createdAt: r.createdAt?.toISOString() ?? null,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    }));
  } catch {
    // Table may not exist yet
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <QuestionnaireManagerClient initialQuestionnaires={questionnaires} />
    </div>
  );
}
