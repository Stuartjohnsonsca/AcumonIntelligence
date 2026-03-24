import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { FsLinesClient } from '@/components/methodology-admin/FsLinesClient';

export default async function FsLinesPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) redirect('/access-denied');

  const firmId = session.user.firmId;

  const [fsLines, industries] = await Promise.all([
    prisma.methodologyFsLine.findMany({
      where: { firmId },
      include: { industryMappings: { select: { industryId: true } } },
      orderBy: [{ isMandatory: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.methodologyIndustry.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }),
  ]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Financial Statement Lines</h1>
        <p className="text-slate-600 mt-1">Define FS line items and map them to industries</p>
      </div>
      <FsLinesClient
        firmId={firmId}
        initialFsLines={fsLines}
        initialIndustries={industries}
      />
    </div>
  );
}
