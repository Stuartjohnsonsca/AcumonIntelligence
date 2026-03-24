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
  const frameworks: Record<string, string> = {};
  let frameworkOptions: string[] = [];

  for (const t of templates) {
    if (t.auditType === '__framework_options') {
      frameworkOptions = t.items as string[];
    } else {
      mappings[t.auditType] = t.items as string[];
      // Framework stored alongside in the config
      const data = t.items as unknown as { schedules?: string[]; framework?: string };
      // Items might be just an array (schedules) or could have framework in a separate record
    }
  }

  // Load frameworks from a separate query if stored differently
  const fwTemplates = await prisma.methodologyTemplate.findMany({
    where: { firmId: session.user.firmId, templateType: 'audit_type_framework' },
  });
  for (const t of fwTemplates) {
    frameworks[t.auditType] = (t.items as unknown as { framework: string })?.framework || '';
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Type Configuration</h1>
        <p className="text-slate-600 mt-1">Configure accounting frameworks and schedules for each audit type</p>
      </div>
      <AuditTypeSchedulesClient
        firmId={session.user.firmId}
        initialMappings={mappings}
        initialFrameworks={frameworks}
        initialFrameworkOptions={frameworkOptions.length > 0 ? frameworkOptions : undefined}
      />
    </div>
  );
}
