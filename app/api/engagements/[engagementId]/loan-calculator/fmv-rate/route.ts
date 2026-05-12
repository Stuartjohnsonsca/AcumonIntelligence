import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/loan-calculator/fmv-rate
 *
 * Ask Claude to research a defensible Fair-Market-Value discount rate
 * for the loan(s) — given the loan profile (size, term, security,
 * borrower credit signals). The LLM returns:
 *   - rate (annual %)
 *   - justification (one paragraph explaining the build-up:
 *     base rate + credit premium + illiquidity premium)
 *   - sources (URLs + titles it consulted — we don't actually fetch
 *     them here, but the LLM cites the publicly-known references it
 *     would use, e.g. BoE base, ICE BofA US High Yield Index, Damodaran
 *     country/equity risk premium).
 *
 * The auditor reviews and edits before saving — no fabricated rate is
 * applied automatically.
 *
 * Body: { side: 'receivable'|'liability', loanProfile: {...} }
 * Response: { rate, justification, sources }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, period: { select: { endDate: true } } },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const loanProfile = body?.loanProfile || {};
  const periodEnd = engagement.period?.endDate?.toISOString().slice(0, 10) || 'today';

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      rate: null,
      justification: '',
      sources: [],
      error: 'No AI key configured — enter the rate manually with a written justification.',
    });
  }

  const sys = `You are an audit FRS 102 / IFRS 9 expert helping an auditor pick a defensible
discount rate to revalue a loan receivable to fair market value at the
audit period end. You DO NOT have web access in this call. Cite only
publicly well-known reference series the auditor can later verify
(Bank of England base rate, ICE BofA US High Yield Index OAS,
Aswath Damodaran's annual default-spread tables, Refinitiv league
tables for similar-size LBO debt, etc.). Build the rate up explicitly:
risk-free + credit spread + illiquidity premium. If information is
missing, say so and propose a range.

Output STRICTLY JSON:
{
  "rate": <annual %, e.g. 8.5>,
  "justification": "<one paragraph showing the build-up>",
  "sources": [
    { "title": "<reference name>", "url": "<best-guess URL or empty string>" }
  ]
}`;

  const user = [
    `Audit period end: ${periodEnd}.`,
    'Loan profile:',
    '```json',
    JSON.stringify(loanProfile, null, 2),
    '```',
    '',
    'Recommend a discount rate and justify it.',
  ].join('\n');

  try {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        temperature: 0.1,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ rate: null, justification: '', sources: [], error: `LLM HTTP ${res.status}: ${txt.slice(0, 200)}` });
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const trimmed = String(raw).trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    let parsed: any = {};
    try { parsed = JSON.parse(trimmed); } catch { parsed = { rate: null, justification: raw, sources: [] }; }
    return NextResponse.json({
      rate: typeof parsed.rate === 'number' ? parsed.rate : null,
      justification: typeof parsed.justification === 'string' ? parsed.justification : '',
      sources: Array.isArray(parsed.sources)
        ? parsed.sources
            .filter((s: any) => s && (s.title || s.url))
            .map((s: any) => ({
              title: String(s.title || ''),
              url: String(s.url || ''),
              capturedAt: new Date().toISOString(),
            }))
        : [],
    });
  } catch (e: any) {
    return NextResponse.json({ rate: null, justification: '', sources: [], error: String(e?.message || e) });
  }
}
