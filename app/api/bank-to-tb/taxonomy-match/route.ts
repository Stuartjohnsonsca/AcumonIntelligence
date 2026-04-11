import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTaxonomyIdForFramework, searchConcepts } from '@/lib/xbrl-taxonomy';

const TOGETHER_KEY = process.env.TOGETHER_API_KEY || '';
const AI_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

interface AccountInput {
  index: number;
  accountCode: string;
  accountName: string;
  categoryType: string;
}

/**
 * POST - AI-based taxonomy matching.
 * Takes current TB accounts and proposes XBRL taxonomy codes.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, framework, accounts } = body as {
    sessionId: string;
    framework: string;
    accounts: AccountInput[];
  };

  if (!framework || !accounts?.length) {
    return NextResponse.json({ error: 'framework and accounts required' }, { status: 400 });
  }

  const taxonomyId = getTaxonomyIdForFramework(framework);
  if (!taxonomyId) {
    return NextResponse.json({ error: `No taxonomy found for framework: ${framework}` }, { status: 400 });
  }

  try {
    // Step 1: Get taxonomy concepts for matching context
    // Search for common financial terms to build a reference list
    const searchTerms = ['revenue', 'cost', 'asset', 'liability', 'equity', 'cash', 'trade', 'tax', 'depreciation', 'interest'];
    const conceptsMap = new Map<string, string>();

    await Promise.all(searchTerms.map(async (term) => {
      try {
        const concepts = await searchConcepts(taxonomyId, term);
        for (const c of concepts.slice(0, 10)) {
          if (!c.abstract && c.label) {
            conceptsMap.set(c.name, c.label);
          }
        }
      } catch { /* non-fatal */ }
    }));

    const taxonomyConcepts = Array.from(conceptsMap.entries())
      .map(([name, label]) => `${name}: ${label}`)
      .slice(0, 100)
      .join('\n');

    // Step 2: Ask AI to match accounts to taxonomy concepts
    const accountsList = accounts.map(a =>
      `${a.index}|${a.accountCode}|${a.accountName}|${a.categoryType}`
    ).join('\n');

    const prompt = `You are an audit assistant matching Chart of Accounts entries to ${framework} XBRL taxonomy concepts.

The goal is to find the BEST matching XBRL taxonomy concept for each account based on its ACCOUNT NAME and CATEGORY. The current account code may be blank, a number, or something unrelated to the taxonomy — that's fine, we want to REPLACE it with the correct taxonomy concept code.

Here are reference taxonomy concepts from ${framework}:
${taxonomyConcepts}

Here are the accounts to match (format: index|currentCode|accountName|category):
${accountsList}

For EVERY account, suggest the most appropriate XBRL taxonomy concept. Include ALL rows — even those with blank or numeric codes. The match should be based on the ACCOUNT NAME meaning, not the current code.

Respond in JSON format only:
[{"index":0,"currentCode":"xxx","currentName":"Account Name","proposedCode":"TaxonomyConceptName","proposedName":"Human-readable label","confidence":0.85}]

Rules:
- Include EVERY row — we need a proposed taxonomy code for each account
- confidence should be 0.0-1.0 based on how certain the match is
- Use actual XBRL concept names from the ${framework} taxonomy
- Match based on account name semantics (e.g. "Sales" → "Revenue", "Trade Debtors" → "TradeAndOtherReceivables")
- If unsure, still provide best guess with lower confidence`;

    const aiRes = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOGETHER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are a financial audit expert. Respond only with valid JSON arrays.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4000,
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`AI API error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || '[]';

    // Parse JSON from AI response (handle markdown code blocks)
    let matches: any[];
    try {
      const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      matches = JSON.parse(jsonStr);
    } catch {
      matches = [];
    }

    // Validate and sanitize matches
    const validMatches = matches
      .filter((m: any) => typeof m.index === 'number' && m.proposedCode && m.currentCode)
      .map((m: any) => ({
        index: m.index,
        currentCode: String(m.currentCode),
        currentName: String(m.currentName || accounts[m.index]?.accountName || ''),
        proposedCode: String(m.proposedCode),
        proposedName: String(m.proposedName || m.proposedCode),
        confidence: Math.min(1, Math.max(0, Number(m.confidence) || 0.5)),
      }));

    return NextResponse.json({ matches: validMatches });
  } catch (err: any) {
    console.error('Taxonomy match error:', err);
    return NextResponse.json({ error: err.message || 'Matching failed' }, { status: 500 });
  }
}

/**
 * PUT - Apply approved taxonomy code changes.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, updates } = body as {
    sessionId: string;
    updates: { id: string; accountCode: string }[];
  };

  if (!sessionId || !updates?.length) {
    return NextResponse.json({ error: 'sessionId and updates required' }, { status: 400 });
  }

  try {
    // Update each trial balance entry
    await Promise.all(updates.map(u =>
      prisma.trialBalanceEntry.update({
        where: { id: u.id },
        data: { accountCode: u.accountCode },
      })
    ));

    return NextResponse.json({ success: true, updated: updates.length });
  } catch (err: any) {
    console.error('Taxonomy update error:', err);
    return NextResponse.json({ error: err.message || 'Update failed' }, { status: 500 });
  }
}
