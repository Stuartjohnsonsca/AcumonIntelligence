import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SchedulesClient } from '@/components/methodology-admin/SchedulesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function SchedulesPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/schedules');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const [templates, masterRow] = await Promise.all([
    prisma.methodologyTemplate.findMany({
      where: { firmId: session.user.firmId },
    }),
    // Load the firm's master schedule list so newly-added schedules
    // automatically appear here ready to receive questions.
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: session.user.firmId, tableType: 'master_schedules' } },
    }).catch(() => null),
  ]);

  const masterSchedules = ((masterRow?.data as any)?.schedules as
    | Array<{ key: string; label: string; defaultStage?: string; stage?: string }>
    | undefined) || [];

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Schedules</h1>
        <p className="text-slate-600 mt-1">Edit default templates for audit</p>
      </div>
      <SchedulesClient
        firmId={session.user.firmId}
        initialTemplates={templates}
        masterSchedules={masterSchedules}
      />
    </div>
  );
}
