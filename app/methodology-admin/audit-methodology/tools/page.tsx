import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ToolsSettingsClient } from '@/components/methodology-admin/ToolsSettingsClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function ToolsSettingsPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/audit-methodology/tools');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const settings = await prisma.methodologyToolSetting.findMany({
    where: { firmId: session.user.firmId },
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Tool Settings</h1>
        <p className="text-slate-600 mt-1">Configure method availability per tool and audit type</p>
      </div>
      <ToolsSettingsClient firmId={session.user.firmId} initialSettings={settings} />
    </div>
  );
}
