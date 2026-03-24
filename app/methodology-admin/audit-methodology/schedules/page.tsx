import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SchedulesClient } from '@/components/methodology-admin/SchedulesClient';

export default async function SchedulesPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/schedules');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const templates = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId },
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Schedules</h1>
        <p className="text-slate-600 mt-1">Edit default templates for audit appendices (A-E)</p>
      </div>
      <SchedulesClient firmId={session.user.firmId} initialTemplates={templates} />
    </div>
  );
}
