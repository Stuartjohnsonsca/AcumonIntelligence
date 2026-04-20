import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { FsLinesClient } from '@/components/methodology-admin/FsLinesClient';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { columnExists } from '@/lib/prisma-column-exists';

export default async function FsLinesPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) redirect('/access-denied');

  const firmId = session.user.firmId;

  // Soften the transition period between deploying the schema changes
  // and running the SQL migration: if the new columns aren't in the DB
  // yet, select an explicit column list that skips them.
  const [hasLevelName, hasStatementName] = await Promise.all([
    columnExists('methodology_fs_lines', 'fs_level_name'),
    columnExists('methodology_fs_lines', 'fs_statement_name'),
  ]);

  const preMigrationSelect = {
    id: true, firmId: true, name: true, lineType: true, fsCategory: true,
    sortOrder: true, isActive: true, isMandatory: true, parentFsLineId: true,
    industryMappings: { select: { industryId: true } },
  } as const;

  const [rawFsLines, industries] = await Promise.all([
    hasLevelName && hasStatementName
      ? prisma.methodologyFsLine.findMany({
          where: { firmId },
          include: { industryMappings: { select: { industryId: true } } },
          orderBy: [{ isMandatory: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        })
      : prisma.methodologyFsLine.findMany({
          where: { firmId },
          select: preMigrationSelect,
          orderBy: [{ isMandatory: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        }),
    prisma.methodologyIndustry.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }),
  ]);

  const fsLines = rawFsLines.map(l => ({
    ...(l as Record<string, unknown>),
    fsLevelName: (l as Record<string, unknown>).fsLevelName ?? null,
    fsStatementName: (l as Record<string, unknown>).fsStatementName ?? null,
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Financial Statement Lines</h1>
        <p className="text-slate-600 mt-1">Define FS line items and map them to industries</p>
      </div>
      <FsLinesClient
        firmId={firmId}
        initialFsLines={fsLines as any}
        initialIndustries={industries}
      />
    </div>
  );
}
