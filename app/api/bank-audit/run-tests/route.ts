import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface TestRequest {
  key: string;
  label: string;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { sessionId, tests, performanceMateriality, clearlyTrivial, tolerableError, currency } = await req.json();
    if (!sessionId || !tests?.length) {
      return NextResponse.json({ error: 'sessionId and tests required' }, { status: 400 });
    }

    const auditSession = await prisma.bankAuditSession.findUnique({
      where: { id: sessionId },
      include: { files: true },
    });

    if (!auditSession || auditSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Update materiality values
    await prisma.bankAuditSession.update({
      where: { id: sessionId },
      data: {
        performanceMateriality: performanceMateriality || null,
        clearlyTrivial: clearlyTrivial || null,
        tolerableError: tolerableError || null,
        functionalCurrency: currency || 'GBP',
        status: 'testing',
      },
    });

    const bankData = (auditSession.bankData as Record<string, unknown>[]) || [];
    const results: { key: string; label: string; status: string; resultData: Record<string, unknown>; errorMsg: string | null }[] = [];

    for (const test of tests as TestRequest[]) {
      let resultData: Record<string, unknown> = {};
      let status = 'completed';
      let errorMsg: string | null = null;

      try {
        switch (test.key) {
          case 'check_balance_tb': {
            // Check balance agrees to TB
            // Group by bank account and sum
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available. Cannot check balance to TB.';
            } else {
              resultData = {
                accounts: [],
                totalBalance: 0,
                tbBalance: 0,
                difference: 0,
                status: 'TB data not yet available for comparison',
              };
            }
            break;
          }

          case 'unusual_txn': {
            // AI-powered unusual transaction review
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available for review.';
            } else {
              // TODO: Send to AI for analysis
              resultData = {
                unusualTransactions: [],
                reviewedCount: bankData.length,
                flaggedCount: 0,
                note: 'AI analysis pending - will review transaction patterns against client profile',
              };
            }
            break;
          }

          case 'subsequent_receipts': {
            // Review receipts after period end
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available.';
            } else {
              resultData = {
                subsequentReceipts: [],
                periodEnd: auditSession.periodId,
                note: 'Large receipts after period end will be flagged',
              };
            }
            break;
          }

          case 'subsequent_payments': {
            // Review payments after period end
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available.';
            } else {
              resultData = {
                subsequentPayments: [],
                periodEnd: auditSession.periodId,
                note: 'Large payments and liability indicators after period end will be flagged',
              };
            }
            break;
          }

          case 'capital_txn': {
            // Identify capital transactions
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available.';
            } else {
              resultData = {
                capitalTransactions: [],
                note: 'Potential capital transactions (investments/disinvestments) will be listed by bank account',
              };
            }
            break;
          }

          case 'transfers_match': {
            // Match inter-bank transfers
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available.';
            } else {
              resultData = {
                matchedTransfers: [],
                unmatchedItems: [],
                note: 'Payment-to-receipt matching across bank accounts',
              };
            }
            break;
          }

          case 'page_continuity': {
            // Check statement page continuity
            const files = auditSession.files || [];
            if (!files.length) {
              status = 'error';
              errorMsg = 'No bank statement files uploaded.';
            } else {
              resultData = {
                accounts: [],
                note: 'Page continuity check: Start (covers period start), Continuity (no page gaps), End (covers period end)',
              };
            }
            break;
          }

          default: {
            // Custom test - AI analysis
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available.';
            } else {
              resultData = {
                matchCount: 0,
                transactions: [],
                note: `Custom test: "${test.label}" - AI analysis pending`,
              };
            }
            break;
          }
        }
      } catch (testErr) {
        status = 'error';
        errorMsg = testErr instanceof Error ? testErr.message : 'Test execution failed';
      }

      // Save test result
      await prisma.bankAuditTest.upsert({
        where: { id: `${sessionId}_${test.key}` },
        create: {
          id: `${sessionId}_${test.key}`,
          sessionId,
          testKey: test.key,
          testLabel: test.label,
          isChecked: true,
          status,
          progress: 100,
          resultData: resultData as unknown as never,
          errorMsg,
        },
        update: {
          status,
          progress: 100,
          resultData: resultData as unknown as never,
          errorMsg,
          isChecked: true,
        },
      });

      results.push({ key: test.key, label: test.label, status, resultData, errorMsg });
    }

    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[BankAudit RunTests]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
