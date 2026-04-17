/**
 * Thin linkage helper between the Year-End Accruals Test and the future
 * Unrecorded Liabilities Test.
 *
 * When the Unrecorded Liabilities Test samples post-YE bank payments
 * above PM and asks "does this payment relate to the prior year, and
 * if so, is there an accrual/creditor at YE?", it needs to know what
 * the Accruals Test already verified. This helper exposes, for a given
 * engagement, the set of supplier + amount pairs that the Accruals Test
 * has already traced to a Green marker, so the Unrecorded Liabilities
 * Test can skip ground that is already covered rather than duplicating
 * work or double-counting errors.
 *
 * Read-only: returns a lightweight summary. The Unrecorded Liabilities
 * Test (when implemented) is expected to do its own deeper matching.
 */

import { prisma } from '@/lib/db';

export interface GreenSupportedAccrual {
  sampleItemRef: string;
  supplier: string | null;
  amount: number | null;
  supportingDocument: string | null;
}

/**
 * Return the Green-marked accruals across all executions of the
 * Year-End Accruals Test for a given engagement. The caller (future
 * Unrecorded Liabilities pipeline) uses this to exclude already-
 * supported accruals when it processes post-YE bank payments.
 */
export async function getSupportedAccrualsForEngagement(engagementId: string): Promise<GreenSupportedAccrual[]> {
  const executions = await prisma.testExecution.findMany({
    where: {
      engagementId,
      executionMode: 'action_pipeline',
      testDescription: 'Year-End Accruals Test',
    },
    select: { id: true },
  });
  if (executions.length === 0) return [];

  const markers = await prisma.sampleItemMarker.findMany({
    where: {
      executionId: { in: executions.map(e => e.id) },
      colour: 'green',
    },
  });

  return markers.map(m => {
    const calc = (m.calcJson as Record<string, any>) || {};
    // The calc JSON is populated by handleVerifyAccrualsSample; pull
    // supplier/amount from there when the marker itself doesn't carry
    // them (the marker table only stores the RAG outcome).
    return {
      sampleItemRef: m.sampleItemRef,
      supplier: calc.supplier ?? null,
      amount: typeof calc.amount === 'number' ? calc.amount : null,
      supportingDocument: calc.supporting_document ?? null,
    };
  });
}
