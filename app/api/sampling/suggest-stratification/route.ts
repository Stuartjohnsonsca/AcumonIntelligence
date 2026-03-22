import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiAction } from '@/lib/logger';
import OpenAI from 'openai';

export const maxDuration = 30;

/**
 * POST /api/sampling/suggest-stratification
 * AI-proposed stratification parameters based on population characteristics.
 *
 * Body: {
 *   availableColumns: { key: string; mapped: string }[],
 *   populationSummary: {
 *     recordCount: number,
 *     amountStats: { min, max, mean, median, stdDev },
 *     hasFlags: { override: boolean, exception: boolean, manualAuto: boolean },
 *     uniquePreparers?: number,
 *     uniqueVendors?: number,
 *     uniqueGlCodes?: number,
 *   },
 *   auditContext: { dataType: string, performanceMateriality: number, tolerableMisstatement: number },
 * }
 *
 * Returns: {
 *   features: { name: string; column: string; type: 'numeric'|'categorical'|'flag'; weight: number }[],
 *   allocationRule: 'rule_a' | 'rule_b' | 'rule_c',
 *   allocationParams: { ... },
 *   rationale: string,
 * }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const action = apiAction(req, session.user as { id: string; firmId?: string }, '/api/sampling/suggest-stratification', 'sampling');

  try {
    const body = await req.json();
    const { availableColumns, populationSummary, auditContext } = body;

    if (!availableColumns || !populationSummary) {
      return NextResponse.json({ error: 'availableColumns and populationSummary are required' }, { status: 400 });
    }

    action.info('Suggesting stratification', { recordCount: populationSummary.recordCount });

    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

    const systemPrompt = `You are a senior audit methodologist advising on stratification strategy for audit sampling. Given a population's characteristics and available data columns, recommend the optimal stratification configuration.

You must return ONLY valid JSON with this exact structure:
{
  "features": [
    { "name": "Human-readable name", "column": "mapped_column_name", "type": "numeric" | "categorical" | "flag", "weight": 0.0 to 1.0 }
  ],
  "allocationRule": "rule_a" | "rule_b" | "rule_c",
  "allocationParams": {
    "mediumPct": number (for rule_a, default 30),
    "lowPct": number (for rule_a, default 10),
    "totalN": number (for rule_b),
    "highN": number (for rule_c),
    "mediumN": number (for rule_c),
    "lowN": number (for rule_c)
  },
  "rationale": "2-4 sentence explanation referencing risk characteristics, ISA requirements, and the population's specific attributes"
}

Guidelines:
- Always include the amount/value column as a numeric feature with weight 1.0
- Include flag columns (override, exception) if available — these are strong risk indicators
- Include categorical columns (preparer, vendor, GL code) only if they have meaningful variance (not too many unique values)
- Rule A (100% high, n% medium, m% low) is best when high-risk items must be fully tested
- Rule B (fixed total, proportional) is best when sample budget is constrained
- Rule C (custom) is best when the auditor has specific coverage requirements per stratum
- For small populations (<200), prefer Rule A or Rule C
- For large populations (>1000), Rule B with a sensible total is often practical
- The rationale must reference ISA 530 or professional standards and be defensible to a regulator`;

    const userPrompt = `Recommend stratification parameters for this audit population:

AVAILABLE COLUMNS (mapped):
${availableColumns.map((c: { key: string; mapped: string }) => `- ${c.key}: mapped to "${c.mapped}"`).join('\n')}

POPULATION SUMMARY:
- Record count: ${populationSummary.recordCount}
- Amount range: ${populationSummary.amountStats.min} to ${populationSummary.amountStats.max}
- Amount mean: ${populationSummary.amountStats.mean.toFixed(2)}, median: ${populationSummary.amountStats.median.toFixed(2)}, std dev: ${populationSummary.amountStats.stdDev.toFixed(2)}
- Override flag available: ${populationSummary.hasFlags.override ? 'Yes' : 'No'}
- Exception flag available: ${populationSummary.hasFlags.exception ? 'Yes' : 'No'}
- Manual/auto flag available: ${populationSummary.hasFlags.manualAuto ? 'Yes' : 'No'}
${populationSummary.uniquePreparers ? `- Unique preparers: ${populationSummary.uniquePreparers}` : ''}
${populationSummary.uniqueVendors ? `- Unique vendors/customers: ${populationSummary.uniqueVendors}` : ''}
${populationSummary.uniqueGlCodes ? `- Unique GL codes: ${populationSummary.uniqueGlCodes}` : ''}

AUDIT CONTEXT:
- Data type: ${auditContext.dataType}
- Performance materiality: ${auditContext.performanceMateriality}
- Tolerable misstatement: ${auditContext.tolerableMisstatement}

What stratification configuration do you recommend?`;

    const result = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.2,
    });

    let content = result.choices?.[0]?.message?.content?.trim() || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        await action.success('Stratification suggested', { allocationRule: parsed.allocationRule, featureCount: parsed.features?.length });
        return NextResponse.json(parsed);
      } catch { /* fall through */ }
    }

    await action.warn('AI returned non-JSON suggestion', { contentPreview: content.slice(0, 200) });
    return NextResponse.json({
      error: 'Could not generate a suggestion. Please configure stratification manually.',
    }, { status: 500 });

  } catch (error) {
    await action.error(error, { stage: 'suggest_stratification' });
    return action.errorResponse(error);
  }
}
