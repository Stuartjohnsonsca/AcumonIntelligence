import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * AI re-check for the Permanent file Taxation section.
 *
 * Trigger: Tax on Profits panel load when the section's content hash
 * has drifted since the last check, or on demand from the toolbar.
 * Returns a confidence flag + short summary the auditor can read,
 * plus the new hash so the panel knows when to re-fire.
 *
 * Cheap by design — single-shot prompt against a fast Together AI
 * model. The prompt summarises engagement context + the auditor's
 * Permanent-tab answers and asks the model to flag inconsistencies
 * (e.g. UK Ltd marked "not subject to tax on profits").
 */

const client = new OpenAI({
  apiKey: process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY || '',
  baseURL: 'https://api.together.xyz/v1',
});

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      firmId: true,
      client: { select: { clientName: true } },
    },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function POST(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Pull the Permanent file answers — flatten all sections by question
  // id so this still works if an admin moves the Taxation questions to
  // a different section. Stable ids on the seeded questions guarantee
  // we find the right answers.
  const pfRows = await prisma.auditPermanentFile.findMany({
    where: { engagementId },
  });
  const flat: Record<string, unknown> = {};
  for (const row of pfRows) {
    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      Object.assign(flat, row.data as Record<string, unknown>);
    }
  }
  const subjectToTax = String(flat['pf_taxation_subject_to_tax_on_profits'] || '');
  const jurisdictions = String(flat['pf_taxation_jurisdictions_note'] || '');
  const referenceNumbers = String(flat['pf_taxation_reference_numbers'] || '');

  // Compute the hash up-front so we can short-circuit when nothing
  // has changed since the last run. Saves the AI call on every panel
  // load and matches the spec ("only triggered if there is a change
  // to the Permanent tab in the Taxation section").
  const hashSource = `${subjectToTax}|${jurisdictions}|${referenceNumbers}`;
  const permanentTaxationHash = await sha256(hashSource);

  const existing = await prisma.auditTaxOnProfits.findUnique({ where: { engagementId } });
  const existingData = (existing?.data && typeof existing.data === 'object' && !Array.isArray(existing.data))
    ? existing.data as Record<string, unknown>
    : {};
  const url = new URL(_req.url);
  const force = url.searchParams.get('force') === '1';
  if (!force && existingData.permanentTaxationHash === permanentTaxationHash && existingData.aiVerification) {
    return NextResponse.json({
      aiVerification: existingData.aiVerification,
      permanentTaxationHash,
      cached: true,
    });
  }

  const prompt = `You are reviewing whether an audit client's Permanent-tab Taxation responses are consistent with the entity's profile.

Client name: ${eng.client?.clientName || '(unknown)'}
Permanent-tab Taxation answers:
- Subject to tax on its profits (Y/N): ${subjectToTax || '(unanswered)'}
- Jurisdiction notes: ${jurisdictions || '(blank)'}
- Tax reference numbers: ${referenceNumbers || '(blank)'}

Question: based purely on the answers above and the client name, is the Y/N answer plausible? Reply in two short lines:
1. confidence: high | medium | low
2. summary: one sentence explaining the reasoning. Mention any inconsistency (e.g. UK Ltd entities are usually subject to UK Corporation Tax).`;

  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let summary = 'AI verification unavailable — no model response.';
  try {
    const completion = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: 'You are an audit-quality assistant. Be terse and specific.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });
    const text = completion.choices[0]?.message?.content || '';
    const m = text.match(/confidence:\s*(high|medium|low)/i);
    if (m) confidence = m[1].toLowerCase() as 'high' | 'medium' | 'low';
    const s = text.match(/summary:\s*(.+)/i);
    summary = s?.[1]?.trim() || text.split('\n').filter(Boolean).pop() || text.trim() || summary;
  } catch (err) {
    summary = `AI verification failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
    confidence = 'low';
  }

  // Persist the verification + hash on the engagement's tax-on-profits blob.
  const aiVerification = {
    confidence,
    summary,
    checkedAt: new Date().toISOString(),
  };
  await prisma.auditTaxOnProfits.upsert({
    where: { engagementId },
    create: { engagementId, data: { ...existingData, aiVerification, permanentTaxationHash } as object },
    update: { data: { ...existingData, aiVerification, permanentTaxationHash } as object },
  });

  return NextResponse.json({ aiVerification, permanentTaxationHash });
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  // Web Crypto is available in Node 18+ via globalThis.crypto.subtle.
  const buf = await (globalThis.crypto as Crypto).subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
