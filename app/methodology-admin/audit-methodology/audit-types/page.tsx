import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AuditTypeSchedulesClient } from '@/components/methodology-admin/AuditTypeSchedulesClient';

export default async function AuditTypesPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) redirect('/my-account');

  const templates = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId, templateType: 'audit_type_schedules' },
  });

  const mappings: Record<string, string[]> = {};
  for (const t of templates) {
    mappings[t.auditType] = t.items as string[];
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Type Schedules</h1>
        <p className="text-slate-600 mt-1">Configure which schedules apply to each audit type</p>
      </div>
      <AuditTypeSchedulesClient firmId={session.user.firmId} initialMappings={mappings} />
    </div>
  );
}
