import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { PointHeadingsClient } from '@/components/methodology-admin/PointHeadingsClient';

export default async function PointHeadingsPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) redirect('/access-denied');

  const firmId = session.user.firmId;

  const [mgtTemplate, repTemplate] = await Promise.all([
    prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: 'management_headings', auditType: 'ALL' } },
    }),
    prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, templateType: 'representation_headings', auditType: 'ALL' } },
    }),
  ]);

  return (
    <div data-howto-id="page.audit-methodology-point-headings.body" className="container mx-auto px-4 py-10 max-w-4xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Point Headings</h1>
        <p className="text-slate-600 mt-1">Manage heading categories for Management Letters and Representation Letters</p>
      </div>
      <PointHeadingsClient
        managementHeadings={(mgtTemplate?.items as string[]) || []}
        representationHeadings={(repTemplate?.items as string[]) || []}
        managementTemplateId={mgtTemplate?.id || null}
        representationTemplateId={repTemplate?.id || null}
      />
    </div>
  );
}
