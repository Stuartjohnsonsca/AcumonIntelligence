import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { FirmAssumptionsClient } from '@/components/methodology-admin/FirmAssumptionsClient';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { getFirmIndependenceQuestions, defaultIndependenceQuestions, getFirmIndependenceRefreshRules } from '@/lib/independence';

export default async function FirmAssumptionsPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/firm-assumptions');
  }

  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const firmId = session.user.firmId;

  // Load existing risk tables for this firm
  let riskTables: any[] = [];
  try {
    riskTables = await prisma.methodologyRiskTable.findMany({ where: { firmId } });
  } catch { /* table may not exist yet */ }

  // Load existing sampling config for confidence settings
  let samplingConfig: any = null;
  try {
    samplingConfig = await prisma.firmSamplingConfig.findUnique({ where: { firmId } });
  } catch { /* table may not exist yet */ }

  const tablesMap: Record<string, any> = {};
  for (const t of riskTables) {
    tablesMap[t.tableType] = t.data;
  }

  const specialistRoles: string[] = (tablesMap.specialistRoles?.roles as string[]) || ['EQR', 'Valuations', 'Ethics', 'Technical'];
  const testCategories: string[] = (tablesMap.testCategories?.categories as string[]) || ['Significant Risk', 'Area of Focus', 'Other', 'Analytical Review', 'Mandatory'];
  const arConfidenceFactor: number = (tablesMap.arConfidenceFactor?.confidenceFactor as number) ?? 1.0;
  const largeUnusualScoring = tablesMap.large_unusual_scoring || null;
  const firmFees: number = (tablesMap.firm_fees?.amount as number) ?? 0;
  const firmVariables: Array<{ name: string; label: string; value: number }> = Array.isArray(tablesMap.firm_variables?.variables)
    ? (tablesMap.firm_variables.variables as Array<{ name: string; label: string; value: number }>)
    : [];

  // Independence Questions — firm-wide questionnaire each team member must
  // confirm before they can access an engagement. Seeded with a sensible
  // default set if the firm hasn't configured anything yet.
  const existingIndependence = await getFirmIndependenceQuestions(firmId);
  const initialIndependenceQuestions = existingIndependence.length > 0 ? existingIndependence : defaultIndependenceQuestions();
  const initialIndependenceRefreshRules = await getFirmIndependenceRefreshRules(firmId);

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Firm Wide Assumptions</h1>
        <p className="text-slate-600 mt-1">Risk tables, confidence levels, and assertion mappings</p>
      </div>
      <FirmAssumptionsClient
        firmId={firmId}
        initialInherentRisk={tablesMap.inherent || null}
        initialControlRisk={tablesMap.control || null}
        initialAssertions={tablesMap.assertions || null}
        initialConfidenceLevel={samplingConfig?.confidenceLevel ?? 95}
        initialConfidenceTable={samplingConfig?.confidenceFactorTable as any || null}
        initialSpecialistRoles={specialistRoles}
        initialRiskClassification={tablesMap.riskClassification || null}
        initialFxProvider={tablesMap.fxProvider?.provider || null}
        initialTestCategories={testCategories}
        initialArConfidenceFactor={arConfidenceFactor}
        initialLargeUnusualScoring={largeUnusualScoring}
        initialFirmFees={firmFees}
        initialFirmVariables={firmVariables}
        initialIndependenceQuestions={initialIndependenceQuestions}
        initialIndependenceRefreshRules={initialIndependenceRefreshRules}
      />
    </div>
  );
}
