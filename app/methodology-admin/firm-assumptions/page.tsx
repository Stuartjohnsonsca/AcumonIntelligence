import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { FirmAssumptionsClient } from '@/components/methodology-admin/FirmAssumptionsClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function FirmAssumptionsPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/firm-assumptions');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  // Load existing risk tables for this firm
  const riskTables = await prisma.methodologyRiskTable.findMany({
    where: { firmId: session.user.firmId },
  });

  // Load existing sampling config for confidence settings
  const samplingConfig = await prisma.firmSamplingConfig.findUnique({
    where: { firmId: session.user.firmId },
  });

  const tablesMap: Record<string, any> = {};
  for (const t of riskTables) {
    tablesMap[t.tableType] = t.data;
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Firm Wide Assumptions</h1>
        <p className="text-slate-600 mt-1">Risk tables, confidence levels, and assertion mappings</p>
      </div>
      <FirmAssumptionsClient
        firmId={session.user.firmId}
        initialInherentRisk={tablesMap.inherent || null}
        initialControlRisk={tablesMap.control || null}
        initialAssertions={tablesMap.assertions || null}
        initialConfidenceLevel={samplingConfig?.confidenceLevel ?? 95}
        initialConfidenceTable={samplingConfig?.confidenceFactorTable as any || null}
      />
    </div>
  );
}
