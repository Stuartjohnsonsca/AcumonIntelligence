import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';

/**
 * Batched AI fuzzy-match endpoint used by the schedule-triggers runtime.
 *
 * Request body:
 *   { pairs: Array<{ expected: string; actual: string }> }
 *
 * Response body:
 *   { results: boolean[] }  // same length as pairs
 *
 * For every pair, returns true when the `actual` answer is semantically
 * equivalent (or a close synonym / same intent) as `expected`. The endpoint
 * uses a single batched Together AI call so latency is O(1) regardless of
 * pair count.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
  if (pairs.length === 0) {
    return NextResponse.json({ results: [] });
  }
  // Cap batch size defensively so a misbehaving caller can't trigger a huge prompt
  const MAX = 40;
  const capped: Array<{ expected: string; actual: string }> = pairs.slice(0, MAX);

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    // Graceful fallback: no AI key configured → treat every fuzzy match as "not matching"
    return NextResponse.json({ results: capped.map(() => false) });
  }

  const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
  const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

  const numbered = capped
    .map((p, i) => `${i + 1}. Expected: ${JSON.stringify(p.expected)} | Actual: ${JSON.stringify(p.actual)}`)
    .join('\n');

  const systemPrompt = `You are a semantic-equivalence judge for audit-schedule visibility rules. For each numbered pair below, decide whether the ACTUAL answer means essentially the same thing as the EXPECTED answer. Be lenient about casing, tense, synonyms, common abbreviations, spelling variants, and brief paraphrases — but strict about opposites, negations, and materially different meanings.

Respond with exactly one line per pair in the order given. Each line must be "${'<number>. YES'}" or "${'<number>. NO'}". No other text, no explanations.`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: numbered },
      ],
      max_tokens: Math.max(64, capped.length * 8),
      temperature: 0,
    });

    const text = completion.choices[0]?.message?.content || '';
    // Parse: one line per pair, look for "N. YES" / "N. NO"
    const results: boolean[] = new Array(capped.length).fill(false);
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d+)[\).:\-]?\s*(YES|NO)/i);
      if (!m) continue;
      const idx = parseInt(m[1], 10) - 1;
      if (idx >= 0 && idx < results.length) {
        results[idx] = m[2].toUpperCase() === 'YES';
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[trigger-fuzzy-match] AI call failed:', err);
    // Fail closed — on error, no match (safer than false positives)
    return NextResponse.json({ results: capped.map(() => false) });
  }
}
