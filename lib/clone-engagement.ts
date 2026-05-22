/**
 * Super-Admin clone-engagement helper.
 *
 * Spec (locked with the user via prompt 2026-05-22):
 *   Target: same client, same period, new engagement id.
 *   Carry over: methodology + setup work only — TB rows, RMM rows,
 *     materiality, audit plan customisations, team members, permanent
 *     file (excluding tab sign-off section), specialists, contacts,
 *     agreed dates, info requests, planning-side workspace tabs
 *     (Ethics / Continuance / New Client / Independence / PAR), plus
 *     firm-side library + portal Principal config that doesn't relate
 *     to client interaction.
 *   Strip: every test execution, conclusion, audit point, finding,
 *     error, signoff record. Plus the four portal interaction tables
 *     the user named — PortalRequest (+cascading PortalUpload),
 *     PortalMessage, ClientPortalPreviewSession, and any per-engagement
 *     comms-channel preferences.
 *
 * Returns the new engagement id. Atomic via a single Prisma
 * transaction — if any step fails the whole clone rolls back so we
 * never leave half a clone in the DB.
 */

import { prisma } from '@/lib/db';

/** Tag for the tab-level signoff section in AuditPermanentFile — see
 *  components/methodology/panels/AuditPlanPanel.tsx. Skipped during
 *  permanent-file copy so the new clone starts with every tab dot
 *  un-stamped. */
const PERM_FILE_SIGNOFF_SECTION = 'audit_plan_tab_signoffs';

export interface CloneEngagementInput {
  sourceEngagementId: string;
  cloneLabel?: string | null;
  /** Super-Admin user id — stamped onto the new engagement's
   *  createdById so the audit trail shows who cloned. */
  createdById: string;
}

export interface CloneEngagementResult {
  newEngagementId: string;
  cloneIndex: number;
  cloneLabel: string | null;
  copied: Record<string, number>;
  stripped: string[];
}

export async function cloneEngagement(input: CloneEngagementInput): Promise<CloneEngagementResult> {
  const { sourceEngagementId, cloneLabel, createdById } = input;

  const source = await prisma.auditEngagement.findUnique({ where: { id: sourceEngagementId } });
  if (!source) throw new Error('Source engagement not found');

  // Find the next cloneIndex for this (client, period, auditType)
  // tuple. The widened unique constraint includes cloneIndex so we
  // can stack multiple clones; we just need the max + 1.
  const max = await prisma.auditEngagement.aggregate({
    where: { clientId: source.clientId, periodId: source.periodId, auditType: source.auditType },
    _max: { cloneIndex: true } as any,
  });
  const nextCloneIndex = ((max as any)._max?.cloneIndex || 0) + 1;

  // Hoist source id into a const so the transaction closures don't
  // lose TS's non-null narrowing on `source` inside their callbacks.
  const sourceId = source.id;

  return prisma.$transaction(async (tx) => {
    const copied: Record<string, number> = {};

    // ── New engagement row ────────────────────────────────────────────
    const created = await (tx.auditEngagement as any).create({
      data: {
        clientId: source.clientId,
        periodId: source.periodId,
        firmId: source.firmId,
        auditType: source.auditType,
        framework: source.framework,
        methodologyVersionId: source.methodologyVersionId,
        infoRequestType: source.infoRequestType,
        hardCloseDate: source.hardCloseDate,
        isGroupAudit: source.isGroupAudit,
        isNewClient: source.isNewClient,
        tbViewMode: source.tbViewMode,
        tbXeroSummary: source.tbXeroSummary as any,
        planCreated: source.planCreated,
        farEnabled: source.farEnabled,
        farAssetType: source.farAssetType,
        farScope: source.farScope,
        farCategories: source.farCategories as any,
        methodologyIndustryId: source.methodologyIndustryId,
        // Portal Principal designation + escalation days are carried
        // over per the user's q3 answer — only the four "client-side
        // interaction" tables (requests / messages / previews / comms
        // prefs) get stripped, not the firm-side portal config.
        portalPrincipalId: source.portalPrincipalId,
        portalEscalationDays1: source.portalEscalationDays1,
        portalEscalationDays2: source.portalEscalationDays2,
        portalEscalationDays3: source.portalEscalationDays3,
        wecomGroupWebhookUrl: source.wecomGroupWebhookUrl,
        auditCategory: (source as any).auditCategory,
        // Reset scalars
        status: 'pre_start',
        createdById,
        startedAt: null,
        completedAt: null,
        portalSetupCompletedAt: null,
        cloneOfId: sourceId,
        cloneIndex: nextCloneIndex,
        cloneLabel: cloneLabel || null,
      },
    });
    const newId: string = created.id;

    // ── Helper: bulk-copy a table on engagementId ────────────────────
    async function copyByEngagementId(modelName: keyof typeof tx, label: string): Promise<void> {
      // Each call: findMany on source.id, strip the source id, retarget
      // engagementId, then createMany. Some tables have unique
      // constraints (engagementId unique) — those still work because
      // we're inserting under a NEW engagementId.
      const model = (tx as any)[modelName];
      if (!model?.findMany) return;
      const rows = await model.findMany({ where: { engagementId: sourceId } });
      if (rows.length === 0) { copied[label] = 0; return; }
      const data = rows.map((r: any) => {
        const { id: _omitId, ...rest } = r;
        return { ...rest, engagementId: newId };
      });
      await model.createMany({ data, skipDuplicates: true });
      copied[label] = data.length;
    }

    // ── Carry-over tables (methodology + setup) ──────────────────────
    await copyByEngagementId('auditTeamMember', 'team');
    await copyByEngagementId('auditSpecialist', 'specialists');
    await copyByEngagementId('auditClientContact', 'contacts');
    await copyByEngagementId('auditAgreedDate', 'agreedDates');
    await copyByEngagementId('auditInformationRequest', 'infoRequests');

    // Permanent file — copy every section EXCEPT the tab signoffs
    // section so the clone's tab dots start un-stamped.
    const permRows = await tx.auditPermanentFile.findMany({ where: { engagementId: sourceId } });
    const permKeep = permRows.filter(r => r.sectionKey !== PERM_FILE_SIGNOFF_SECTION);
    if (permKeep.length > 0) {
      await tx.auditPermanentFile.createMany({
        data: permKeep.map(r => ({ engagementId: newId, sectionKey: r.sectionKey, data: r.data as any })),
        skipDuplicates: true,
      });
    }
    copied.permanentFile = permKeep.length;

    // Single-row planning workspace tables (engagementId is @unique).
    // These are firm-side preparation work, not test execution — so
    // they carry over per option 2.
    await copyByEngagementId('auditEthics', 'ethics');
    await copyByEngagementId('auditContinuance', 'continuance');
    await copyByEngagementId('auditNewClientTakeOn', 'newClient');
    await copyByEngagementId('auditMemberIndependence', 'memberIndependence');
    await copyByEngagementId('auditMateriality', 'materiality');

    // PAR rows — preliminary analytical review entries. Carry over.
    await copyByEngagementId('auditPARRow', 'parRows');

    // RMM rows — risk register. Carry over.
    await copyByEngagementId('auditRMMRow', 'rmmRows');

    // TB rows — the trial balance. Largest table by row count.
    await copyByEngagementId('auditTBRow', 'tbRows');

    // Firm-side document library + sent-to-client documents — user did
    // NOT tick these in the strip list, so they ride along.
    await copyByEngagementId('auditDocument', 'auditDocuments');

    // Portal Staff allocations + work allocation grid — user did NOT
    // tick these in the strip list, so they ride along too. The
    // Portal Principal designation is on the engagement scalar
    // already copied above.
    await copyByEngagementId('clientPortalStaffMember', 'portalStaff');
    await copyByEngagementId('clientPortalWorkAllocation', 'portalWorkAllocation');

    // PortalDocument lives off Client (not engagement) but carries an
    // engagementId. Copy so the clone keeps the same "sent to client"
    // history (e.g. the planning letter the firm already issued).
    const portalDocs = await (tx as any).portalDocument.findMany({ where: { engagementId: sourceId } });
    if (portalDocs.length > 0) {
      await (tx as any).portalDocument.createMany({
        data: portalDocs.map((d: any) => {
          const { id: _id, ...rest } = d;
          return { ...rest, engagementId: newId };
        }),
        skipDuplicates: true,
      });
      copied.portalDocuments = portalDocs.length;
    }

    // ── EXPLICITLY NOT COPIED (matches the user's strip choice) ─────
    // These tables are NOT copied. The new engagement starts empty
    // for each so the auditor (or demo / sandbox user) runs every
    // test, files every conclusion, and the client re-interacts with
    // the portal from a clean slate.
    const stripped = [
      'testExecutions',               // TestExecution + cascading nodeRuns
      'testConclusions',              // AuditTestConclusion (per-row R/RI signoffs included)
      'errorSchedule',                // AuditErrorSchedule (errors found in the audit)
      'auditPoints',                  // AuditPoint (review points / management points raised)
      'taxChat',                      // AuditTaxChat (tax technical discussions)
      'journalRiskRuns',              // JournalRiskRun (MOC test outputs)
      'auditMeetings',                // AuditMeeting (meeting records held in the audit)
      'monitoringReports',            // AuditFileMonitoringReport / Run
      'importSessions',               // ImportHandoffSession + ImportExtractionProposal
      'interrogateInteractions',      // InterrogateInteraction (AI chat with the engagement)
      'engagementActionLog',          // EngagementActionLog (action log for the engagement)
      'pdfReports',                   // AuditPdfReport
      'subsequentEvents',             // AuditSubsequentEvents (post-period findings)
      'vatReconciliation',            // AuditVatReconciliation (per-test data)
      'loanCalculator',               // AuditLoanCalculator (per-test data)
      'taxOnProfits',                 // AuditTaxOnProfits (per-test data)
      'analyticalReview',             // AuditAnalyticalReview (per-test data)
      'payrollTest',                  // AuditPayrollTest (per-test data)
      'outstandingItems',             // OutstandingItem (linked to test executions / portal requests)
      // Portal interaction tables (user's q3 strip list) — these live
      // off Client.engagementId, not the engagement directly, so no
      // child copy is needed at all (we just don't run a copy).
      'portalRequests',               // PortalRequest (+ cascading PortalUpload)
      'portalMessages',               // PortalMessage
      'portalPreviewSessions',        // ClientPortalPreviewSession
    ];

    return { newEngagementId: newId, cloneIndex: nextCloneIndex, cloneLabel: cloneLabel || null, copied, stripped };
  }, { timeout: 120_000 });
}
