import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { verifyClientAccess } from '@/lib/client-access';

interface RowInput {
  rowKey: string;
  rowLabel: string;
}

// Standard assertion mappings based on description patterns
const ASSERTION_RULES: Record<string, string[]> = {
  'revenue': ['completeness', 'occurrence', 'cutOff', 'classification', 'presentation'],
  'cost': ['completeness', 'occurrence', 'cutOff', 'classification'],
  'profit': ['presentation'],
  'expense': ['completeness', 'occurrence', 'cutOff', 'classification'],
  'asset': ['existence', 'valuation', 'rights', 'completeness', 'presentation'],
  'fixed asset': ['existence', 'valuation', 'rights', 'completeness'],
  'tangible': ['existence', 'valuation', 'rights', 'completeness'],
  'intangible': ['existence', 'valuation', 'rights', 'completeness'],
  'investment': ['existence', 'valuation', 'rights'],
  'stock': ['existence', 'valuation', 'completeness'],
  'debtor': ['existence', 'valuation', 'completeness', 'rights'],
  'cash': ['existence', 'completeness'],
  'bank': ['existence', 'completeness'],
  'prepayment': ['existence', 'valuation', 'cutOff'],
  'creditor': ['completeness', 'existence', 'valuation', 'cutOff'],
  'accrual': ['completeness', 'valuation', 'cutOff'],
  'deferred': ['completeness', 'valuation', 'cutOff', 'classification'],
  'loan': ['completeness', 'existence', 'valuation', 'classification', 'presentation'],
  'director': ['completeness', 'existence', 'valuation', 'classification'],
  'share capital': ['existence', 'completeness', 'rights', 'presentation'],
  'retained': ['completeness', 'valuation', 'presentation'],
  'reserve': ['completeness', 'valuation', 'presentation'],
  'tax': ['completeness', 'occurrence', 'valuation', 'cutOff'],
  'interest': ['completeness', 'occurrence', 'cutOff'],
  'liability': ['completeness', 'existence', 'valuation', 'cutOff', 'classification'],
  'operating': ['presentation'],
  'gross': ['presentation'],
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { clientId, rows } = await req.json();
    if (!clientId || !rows?.length) {
      return NextResponse.json({ error: 'clientId and rows required' }, { status: 400 });
    }

    const user = session.user as { id: string; firmId: string; isSuperAdmin?: boolean };
    const access = await verifyClientAccess(user, clientId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
    }

    // Apply rule-based auto-completion
    const suggestions: Record<string, Record<string, boolean>> = {};

    for (const row of rows as RowInput[]) {
      const label = row.rowLabel.toLowerCase();
      const matched: Set<string> = new Set();

      for (const [pattern, assertions] of Object.entries(ASSERTION_RULES)) {
        if (label.includes(pattern)) {
          assertions.forEach(a => matched.add(a));
        }
      }

      if (matched.size > 0) {
        suggestions[row.rowKey] = {
          completeness: matched.has('completeness'),
          occurrence: matched.has('occurrence'),
          cutOff: matched.has('cutOff'),
          classification: matched.has('classification'),
          presentation: matched.has('presentation'),
          existence: matched.has('existence'),
          valuation: matched.has('valuation'),
          rights: matched.has('rights'),
        };
      }
    }

    return NextResponse.json({ suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[FSAssertions AutoComplete]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
