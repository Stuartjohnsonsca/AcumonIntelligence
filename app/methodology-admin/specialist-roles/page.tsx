import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SpecialistRolesClient } from '@/components/methodology-admin/SpecialistRolesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function SpecialistRolesPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/specialist-roles');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const DEFAULT_ROLES = [
    { key: 'ethics_partner',   label: 'Ethics Partner',   name: '', email: '', isActive: true },
    { key: 'mrlo',             label: 'MRLO',             name: '', email: '', isActive: true },
    { key: 'management_board', label: 'Management Board', name: '', email: '', isActive: true },
    { key: 'acp',              label: 'ACP',              name: '', email: '', isActive: true },
  ];

  let initialRoles = DEFAULT_ROLES;
  try {
    const row = await prisma.methodologyTemplate.findUnique({
      where: {
        firmId_templateType_auditType: {
          firmId: session.user.firmId,
          templateType: 'specialist_roles',
          auditType: 'ALL',
        },
      },
    });
    if (Array.isArray(row?.items) && row!.items.length > 0) {
      initialRoles = row!.items as any[];
    }
  } catch { /* tolerant */ }

  return (
    <div data-howto-id="page.specialist-roles.body" className="container mx-auto px-4 py-10 max-w-4xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Specialist Roles</h1>
        <p className="text-sm text-slate-500 mt-1">
          People the firm escalates schedules to for specialist review (Ethics Partner, MRLO, Management Board, ACP,
          or any custom role). Each active role appears in the &ldquo;Send for specialist review&rdquo; dropdown that
          shows on a schedule once the Reviewer has signed it off.
        </p>
      </div>
      <SpecialistRolesClient initialRoles={initialRoles} />
    </div>
  );
}
