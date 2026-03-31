import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { QuestionnaireActionsClient } from '@/components/methodology-admin/QuestionnaireActionsClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function QuestionnaireActionsPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/questionnaire-actions');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  // Load questionnaires
  let questionnaires: any[] = [];
  try {
    const records = await prisma.methodologyTemplate.findMany({
      where: { firmId: session.user.firmId, templateType: 'questionnaire' },
      orderBy: { createdAt: 'desc' },
    });
    questionnaires = records.map((r: any) => {
      const items = typeof r.items === 'object' && r.items !== null ? r.items as Record<string, unknown> : {};
      return {
        id: r.id,
        name: (items.name as string) || 'Untitled',
        groups: (items.groups as any[]) || [],
      };
    });
  } catch {}

  // Load action triggers
  let actionTriggers: string[] = [];
  try {
    const triggerRecord = await prisma.methodologyTemplate.findFirst({
      where: { firmId: '__global__', templateType: 'action_triggers' },
    });
    if (triggerRecord) {
      const items = typeof triggerRecord.items === 'object' && triggerRecord.items !== null
        ? triggerRecord.items as Record<string, unknown> : {};
      actionTriggers = (items as any)?.triggers || (Array.isArray(items) ? items : []);
    }
  } catch {}

  // Fallback defaults
  if (actionTriggers.length === 0) {
    actionTriggers = ['On Start', 'On Upload', 'On Push to Portal', 'On Verification', 'On Portal Response', 'On Section Sign Off'];
  }

  // Load existing mappings
  let mappings: any = {};
  try {
    const mapRecord = await prisma.methodologyTemplate.findFirst({
      where: { firmId: session.user.firmId, templateType: 'questionnaire_actions' },
    });
    if (mapRecord) {
      const items = typeof mapRecord.items === 'object' && mapRecord.items !== null ? mapRecord.items : {};
      mappings = items;
    }
  } catch {}

  const auditTypes = [
    { key: 'SME', label: 'SME' },
    { key: 'PIE', label: 'PIE' },
    { key: 'SME_CONTROLS', label: 'SME Controls' },
    { key: 'PIE_CONTROLS', label: 'PIE Controls' },
  ];

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <QuestionnaireActionsClient
        questionnaires={questionnaires}
        auditTypes={auditTypes}
        actionTriggers={actionTriggers}
        initialMappings={mappings}
      />
    </div>
  );
}
