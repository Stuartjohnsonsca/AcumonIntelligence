import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import OpenAI from 'openai';

export const maxDuration = 300;

interface TestRequest {
  key: string;
  label: string;
}

interface BankTxn {
  date?: string;
  description?: string;
  reference?: string;
  debit?: number;
  credit?: number;
  balance?: number;
  bankName?: string;
  sortCode?: string;
  accountNumber?: string;
  statementDate?: string;
  statementPage?: string;
  sourceFile?: string;
}

function groupByAccount(data: BankTxn[]): Record<string, BankTxn[]> {
  const groups: Record<string, BankTxn[]> = {};
  for (const txn of data) {
    const key = `${txn.bankName || 'Unknown'} | ${txn.sortCode || ''} | ${txn.accountNumber || ''}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(txn);
  }
  return groups;
}

function parseDate(d: string | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function fmt(n: number): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      include: {
        files: true,
        period: { select: { startDate: true, endDate: true } },
      },
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

    const bankData = ((auditSession.bankData as unknown) as BankTxn[]) || [];
    const periodStart = auditSession.period?.startDate ? new Date(auditSession.period.startDate) : null;
    const periodEnd = auditSession.period?.endDate ? new Date(auditSession.period.endDate) : null;
    const ct = Number(clearlyTrivial) || 0;
    const currSymbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
    const accountGroups = groupByAccount(bankData);

    // AI client for analysis tests
    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    const aiClient = apiKey ? new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' }) : null;

    const results: { key: string; label: string; status: string; resultData: Record<string, unknown>; errorMsg: string | null }[] = [];

    for (const test of tests as TestRequest[]) {
      let resultData: Record<string, unknown> = {};
      let status = 'completed';
      let errorMsg: string | null = null;

      try {
        switch (test.key) {

          // ── Check Balance to TB ────────────────────────────────────────
          case 'check_balance_tb': {
            if (!bankData.length) {
              status = 'error';
              errorMsg = 'No bank data available. Cannot check balance to TB.';
              break;
            }

            const accounts: { account: string; bankName: string; sortCode: string; accountNumber: string; closingBalance: number; tbBalance: number | null; difference: number; dotColour: string }[] = [];
            let totalClosing = 0;

            for (const [key, txns] of Object.entries(accountGroups)) {
              const [bankName, sortCode, accountNumber] = key.split(' | ');
              // Find the last transaction balance as closing balance
              const sorted = [...txns].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
              const lastTxn = sorted[sorted.length - 1];
              const closingBalance = Number(lastTxn?.balance) || 0;
              totalClosing += closingBalance;

              // TB balance not yet available - would come from TB integration
              const tbBalance: number | null = null;
              const difference = tbBalance !== null ? closingBalance - tbBalance : 0;
              let dotColour = 'grey'; // no TB data
              if (tbBalance !== null) {
                if (difference === 0) dotColour = 'green';
                else if (Math.abs(difference) <= ct) dotColour = 'orange';
                else dotColour = 'red';
              }

              accounts.push({
                account: key,
                bankName: bankName.trim(),
                sortCode: sortCode.trim(),
                accountNumber: accountNumber.trim(),
                closingBalance,
                tbBalance,
                difference,
                dotColour,
              });
            }

            resultData = {
              type: 'balance_check',
              accounts,
              totalClosingBalance: totalClosing,
              currency: currSymbol,
              note: accounts.length > 0 && accounts.every(a => a.tbBalance === null)
                ? 'Trial Balance data not yet linked. Closing balances shown from bank statements.'
                : undefined,
            };
            break;
          }

          // ── Unusual Transaction Review ─────────────────────────────────
          case 'unusual_txn': {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank data available.'; break; }

            // Calculate statistics for anomaly detection
            const debits = bankData.filter(t => Number(t.debit) > 0).map(t => Number(t.debit));
            const credits = bankData.filter(t => Number(t.credit) > 0).map(t => Number(t.credit));
            const avgDebit = debits.length ? debits.reduce((s, v) => s + v, 0) / debits.length : 0;
            const avgCredit = credits.length ? credits.reduce((s, v) => s + v, 0) / credits.length : 0;
            const stdDebit = debits.length > 1 ? Math.sqrt(debits.reduce((s, v) => s + (v - avgDebit) ** 2, 0) / debits.length) : avgDebit;
            const stdCredit = credits.length > 1 ? Math.sqrt(credits.reduce((s, v) => s + (v - avgCredit) ** 2, 0) / credits.length) : avgCredit;

            // Flag transactions > 2 std deviations from mean
            const threshold = 2;
            const flagged: { date: string; description: string; amount: string; type: string; reason: string }[] = [];

            for (const txn of bankData) {
              const debit = Number(txn.debit) || 0;
              const credit = Number(txn.credit) || 0;
              if (debit > 0 && debit > avgDebit + threshold * stdDebit) {
                flagged.push({
                  date: txn.date || '',
                  description: txn.description || '',
                  amount: `${currSymbol}${fmt(debit)}`,
                  type: 'Payment',
                  reason: `Unusually large payment (avg: ${currSymbol}${fmt(avgDebit)})`,
                });
              }
              if (credit > 0 && credit > avgCredit + threshold * stdCredit) {
                flagged.push({
                  date: txn.date || '',
                  description: txn.description || '',
                  amount: `${currSymbol}${fmt(credit)}`,
                  type: 'Receipt',
                  reason: `Unusually large receipt (avg: ${currSymbol}${fmt(avgCredit)})`,
                });
              }
              // Round number transactions (potential manual entries)
              if ((debit > 1000 && debit % 1000 === 0) || (credit > 1000 && credit % 1000 === 0)) {
                const amt = debit || credit;
                if (!flagged.some(f => f.date === txn.date && f.description === txn.description)) {
                  flagged.push({
                    date: txn.date || '',
                    description: txn.description || '',
                    amount: `${currSymbol}${fmt(amt)}`,
                    type: debit > 0 ? 'Payment' : 'Receipt',
                    reason: 'Round number — potential manual entry',
                  });
                }
              }
            }

            // Also use AI if available for deeper pattern analysis
            let aiInsights: string | null = null;
            if (aiClient && bankData.length > 0) {
              try {
                const sampleTxns = bankData.slice(0, 50).map(t =>
                  `${t.date} | ${t.description} | Dr:${t.debit || 0} | Cr:${t.credit || 0}`
                ).join('\n');
                const aiRes = await aiClient.chat.completions.create({
                  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
                  messages: [{ role: 'user', content: `Review these bank transactions for unusual patterns. List any concerning items briefly (max 5 bullet points):\n\n${sampleTxns}` }],
                  max_tokens: 500,
                  temperature: 0.2,
                });
                aiInsights = aiRes.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
              } catch { /* skip AI if fails */ }
            }

            resultData = {
              type: 'unusual_transactions',
              reviewedCount: bankData.length,
              flaggedCount: flagged.length,
              flagged,
              statistics: {
                avgPayment: `${currSymbol}${fmt(avgDebit)}`,
                avgReceipt: `${currSymbol}${fmt(avgCredit)}`,
                totalPayments: debits.length,
                totalReceipts: credits.length,
              },
              aiInsights,
            };
            break;
          }

          // ── Subsequent Receipts Review ─────────────────────────────────
          case 'subsequent_receipts': {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank data available.'; break; }
            if (!periodEnd) { status = 'error'; errorMsg = 'Period end date not available.'; break; }

            const subsequentReceipts: { date: string; description: string; amount: string; bankAccount: string; flag: string }[] = [];
            const pmThreshold = Number(performanceMateriality) || 0;

            for (const txn of bankData) {
              const txnDate = parseDate(txn.date);
              const credit = Number(txn.credit) || 0;
              if (txnDate && txnDate > periodEnd && credit > 0) {
                const isLarge = credit >= pmThreshold && pmThreshold > 0;
                subsequentReceipts.push({
                  date: txn.date || '',
                  description: txn.description || '',
                  amount: `${currSymbol}${fmt(credit)}`,
                  bankAccount: `${txn.bankName || ''} ${txn.accountNumber || ''}`.trim(),
                  flag: isLarge ? 'Large receipt — review for cut-off' : '',
                });
              }
            }

            // Sort by amount descending
            subsequentReceipts.sort((a, b) => {
              const aVal = parseFloat(a.amount.replace(/[^0-9.-]/g, ''));
              const bVal = parseFloat(b.amount.replace(/[^0-9.-]/g, ''));
              return bVal - aVal;
            });

            resultData = {
              type: 'subsequent_receipts',
              periodEnd: periodEnd.toISOString().split('T')[0],
              count: subsequentReceipts.length,
              receipts: subsequentReceipts.slice(0, 50), // Top 50
              totalAmount: `${currSymbol}${fmt(subsequentReceipts.reduce((s, r) => s + parseFloat(r.amount.replace(/[^0-9.-]/g, '')), 0))}`,
              summary: subsequentReceipts.length === 0
                ? 'No receipts found after the period end date.'
                : `${subsequentReceipts.length} receipt(s) identified after ${periodEnd.toLocaleDateString('en-GB')}.`,
            };
            break;
          }

          // ── Subsequent Payments Review ─────────────────────────────────
          case 'subsequent_payments': {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank data available.'; break; }
            if (!periodEnd) { status = 'error'; errorMsg = 'Period end date not available.'; break; }

            const subsequentPayments: { date: string; description: string; amount: string; bankAccount: string; flag: string }[] = [];
            const pmThresh = Number(performanceMateriality) || 0;

            for (const txn of bankData) {
              const txnDate = parseDate(txn.date);
              const debit = Number(txn.debit) || 0;
              if (txnDate && txnDate > periodEnd && debit > 0) {
                const isLarge = debit >= pmThresh && pmThresh > 0;
                // Check for liability indicators
                const desc = (txn.description || '').toLowerCase();
                const liabilityKeywords = ['invoice', 'bill', 'tax', 'vat', 'hmrc', 'paye', 'rent', 'lease', 'utility', 'insurance'];
                const isLiabilityIndicator = liabilityKeywords.some(k => desc.includes(k));

                subsequentPayments.push({
                  date: txn.date || '',
                  description: txn.description || '',
                  amount: `${currSymbol}${fmt(debit)}`,
                  bankAccount: `${txn.bankName || ''} ${txn.accountNumber || ''}`.trim(),
                  flag: isLarge ? 'Large payment — possible undisclosed liability'
                    : isLiabilityIndicator ? 'Liability indicator — review for accruals'
                    : '',
                });
              }
            }

            subsequentPayments.sort((a, b) => {
              const aVal = parseFloat(a.amount.replace(/[^0-9.-]/g, ''));
              const bVal = parseFloat(b.amount.replace(/[^0-9.-]/g, ''));
              return bVal - aVal;
            });

            resultData = {
              type: 'subsequent_payments',
              periodEnd: periodEnd.toISOString().split('T')[0],
              count: subsequentPayments.length,
              payments: subsequentPayments.slice(0, 50),
              totalAmount: `${currSymbol}${fmt(subsequentPayments.reduce((s, p) => s + parseFloat(p.amount.replace(/[^0-9.-]/g, '')), 0))}`,
              summary: subsequentPayments.length === 0
                ? 'No payments found after the period end date.'
                : `${subsequentPayments.length} payment(s) identified after ${periodEnd.toLocaleDateString('en-GB')}.`,
            };
            break;
          }

          // ── Capital Transactions ───────────────────────────────────────
          case 'capital_txn': {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank data available.'; break; }

            const capitalKeywords = ['asset', 'equipment', 'machinery', 'vehicle', 'property', 'land', 'building',
              'computer', 'furniture', 'fixture', 'freehold', 'leasehold', 'investment', 'shares', 'dividend',
              'capital', 'loan', 'mortgage', 'disposal', 'purchase of', 'sale of', 'acquisition'];

            const capitalTxns: { date: string; description: string; investment: string; disinvestment: string; bankAccount: string }[] = [];

            for (const [accountKey, txns] of Object.entries(accountGroups)) {
              for (const txn of txns) {
                const desc = (txn.description || '').toLowerCase();
                const debit = Number(txn.debit) || 0;
                const credit = Number(txn.credit) || 0;
                const isCapital = capitalKeywords.some(k => desc.includes(k)) || debit >= 5000 || credit >= 5000;

                if (isCapital && (debit > 0 || credit > 0)) {
                  capitalTxns.push({
                    date: txn.date || '',
                    description: txn.description || '',
                    investment: debit > 0 ? `${currSymbol}${fmt(debit)}` : '',
                    disinvestment: credit > 0 ? `${currSymbol}${fmt(credit)}` : '',
                    bankAccount: accountKey,
                  });
                }
              }
            }

            resultData = {
              type: 'capital_transactions',
              count: capitalTxns.length,
              transactions: capitalTxns,
              summary: capitalTxns.length === 0
                ? 'No potential capital transactions identified.'
                : `${capitalTxns.length} potential capital transaction(s) identified for review.`,
            };
            break;
          }

          // ── Transfers Match ────────────────────────────────────────────
          case 'transfers_match': {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank data available.'; break; }

            const accountKeys = Object.keys(accountGroups);
            if (accountKeys.length < 2) {
              resultData = {
                type: 'transfers_match',
                summary: 'Only one bank account detected — transfer matching requires multiple accounts.',
                matched: [],
                unmatched: [],
              };
              break;
            }

            // Find potential transfers: payments in one account matching receipts in another (same date, same amount)
            const transferKeywords = ['transfer', 'tfr', 'sweep', 'internal', 'own account'];
            const allPayments: (BankTxn & { accountKey: string })[] = [];
            const allReceipts: (BankTxn & { accountKey: string })[] = [];

            for (const [key, txns] of Object.entries(accountGroups)) {
              for (const txn of txns) {
                const desc = (txn.description || '').toLowerCase();
                const isTransferLike = transferKeywords.some(k => desc.includes(k));
                if (Number(txn.debit) > 0 && isTransferLike) allPayments.push({ ...txn, accountKey: key });
                if (Number(txn.credit) > 0 && isTransferLike) allReceipts.push({ ...txn, accountKey: key });
              }
            }

            const matched: { date: string; description: string; amount: string; fromAccount: string; toAccount: string }[] = [];
            const usedReceipts = new Set<number>();

            for (const pmt of allPayments) {
              const matchIdx = allReceipts.findIndex((r, idx) =>
                !usedReceipts.has(idx) &&
                r.accountKey !== pmt.accountKey &&
                Math.abs(Number(r.credit) - Number(pmt.debit)) < 0.01
              );
              if (matchIdx >= 0) {
                usedReceipts.add(matchIdx);
                matched.push({
                  date: pmt.date || '',
                  description: pmt.description || '',
                  amount: `${currSymbol}${fmt(Number(pmt.debit))}`,
                  fromAccount: pmt.accountKey,
                  toAccount: allReceipts[matchIdx].accountKey,
                });
              }
            }

            const unmatchedPayments = allPayments.filter((_, i) =>
              !matched.some(m => m.date === allPayments[i].date && m.fromAccount === allPayments[i].accountKey)
            );
            const unmatchedReceipts = allReceipts.filter((_, i) => !usedReceipts.has(i));
            const unmatched = [
              ...unmatchedPayments.map(p => ({
                date: p.date || '', description: p.description || '',
                payment: `${currSymbol}${fmt(Number(p.debit))}`, receipt: '',
                bankAccount: p.accountKey,
              })),
              ...unmatchedReceipts.map(r => ({
                date: r.date || '', description: r.description || '',
                payment: '', receipt: `${currSymbol}${fmt(Number(r.credit))}`,
                bankAccount: r.accountKey,
              })),
            ];

            resultData = {
              type: 'transfers_match',
              matchedCount: matched.length,
              unmatchedCount: unmatched.length,
              matched,
              unmatched,
              summary: matched.length === 0 && unmatched.length === 0
                ? 'No inter-account transfers identified.'
                : `${matched.length} transfer(s) matched, ${unmatched.length} unmatched item(s).`,
            };
            break;
          }

          // ── Page Continuity ────────────────────────────────────────────
          case 'page_continuity': {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank statement data available.'; break; }

            const continuityResults: {
              bankAccount: string; startDot: string; continuityDot: string; endDot: string;
              startNote: string; continuityNote: string; endNote: string;
              pages: string[];
            }[] = [];

            for (const [accountKey, txns] of Object.entries(accountGroups)) {
              const pages = [...new Set(txns.map(t => t.statementPage).filter(Boolean))].sort() as string[];
              const dates = txns.map(t => parseDate(t.date)).filter(Boolean) as Date[];
              const earliest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
              const latest = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

              // Start check
              let startDot = 'orange', startNote = 'Cannot determine';
              if (earliest && periodStart) {
                if (earliest <= periodStart) { startDot = 'green'; startNote = `Covers period start (${periodStart.toLocaleDateString('en-GB')})`; }
                else { startDot = 'red'; startNote = `Earliest statement: ${earliest.toLocaleDateString('en-GB')} — after period start`; }
              }

              // Continuity check
              let continuityDot = 'orange', continuityNote = 'Cannot determine';
              if (pages.length > 0) {
                const pageNums = pages.map(p => parseInt(p)).filter(n => !isNaN(n)).sort((a, b) => a - b);
                if (pageNums.length > 1) {
                  const gaps: number[] = [];
                  for (let i = 1; i < pageNums.length; i++) {
                    if (pageNums[i] !== pageNums[i - 1] + 1) gaps.push(pageNums[i - 1] + 1);
                  }
                  if (gaps.length === 0) {
                    continuityDot = 'green';
                    continuityNote = `Pages ${pageNums[0]}–${pageNums[pageNums.length - 1]} — no gaps`;
                  } else {
                    continuityDot = 'red';
                    continuityNote = `Missing page(s): ${gaps.join(', ')}`;
                  }
                } else if (pageNums.length === 1) {
                  continuityDot = 'green';
                  continuityNote = `Single page (${pageNums[0]})`;
                }
              }

              // End check
              let endDot = 'orange', endNote = 'Cannot determine';
              if (latest && periodEnd) {
                if (latest >= periodEnd) { endDot = 'green'; endNote = `Covers period end (${periodEnd.toLocaleDateString('en-GB')})`; }
                else { endDot = 'red'; endNote = `Latest statement: ${latest.toLocaleDateString('en-GB')} — before period end`; }
              }

              continuityResults.push({
                bankAccount: accountKey,
                startDot, continuityDot, endDot,
                startNote, continuityNote, endNote,
                pages,
              });
            }

            resultData = {
              type: 'page_continuity',
              accounts: continuityResults,
              summary: continuityResults.every(a => a.startDot === 'green' && a.continuityDot === 'green' && a.endDot === 'green')
                ? 'All accounts pass page continuity checks.'
                : 'Some accounts have page continuity issues — review flagged items.',
            };
            break;
          }

          // ── Custom Tests (AI-powered) ──────────────────────────────────
          default: {
            if (!bankData.length) { status = 'error'; errorMsg = 'No bank data available.'; break; }

            const matchingTxns: { date: string; description: string; amount: string; type: string }[] = [];

            if (aiClient) {
              try {
                const sampleTxns = bankData.map(t =>
                  `${t.date}|${t.description}|Dr:${t.debit || 0}|Cr:${t.credit || 0}`
                ).join('\n');
                const aiRes = await aiClient.chat.completions.create({
                  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
                  messages: [{
                    role: 'user',
                    content: `Review these bank transactions and identify any that match this description: "${test.label}"\n\nReturn ONLY valid JSON: {"matches":[{"date":"...","description":"...","debit":0,"credit":0}]}\n\nTransactions:\n${sampleTxns.slice(0, 15000)}`,
                  }],
                  max_tokens: 4000,
                  temperature: 0.1,
                });
                const content = aiRes.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || '';
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  if (Array.isArray(parsed.matches)) {
                    for (const m of parsed.matches) {
                      const debit = Number(m.debit) || 0;
                      const credit = Number(m.credit) || 0;
                      matchingTxns.push({
                        date: m.date || '',
                        description: m.description || '',
                        amount: `${currSymbol}${fmt(debit || credit)}`,
                        type: debit > 0 ? 'Payment' : 'Receipt',
                      });
                    }
                  }
                }
              } catch { /* skip */ }
            }

            resultData = {
              type: 'custom_test',
              testDescription: test.label,
              count: matchingTxns.length,
              transactions: matchingTxns,
              summary: matchingTxns.length === 0
                ? `No transactions matching "${test.label}" were identified.`
                : `${matchingTxns.length} transaction(s) matching "${test.label}" identified.`,
            };
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
