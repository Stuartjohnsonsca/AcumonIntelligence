import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiAction } from '@/lib/logger';
import OpenAI from 'openai';

export const maxDuration = 30;

/**
 * POST /api/sampling/assess-justification
 * AI assessment of whether a sampling justification is defensible to an audit regulator.
 *
 * Body: {
 *   type: 'composite_threshold' | 'judgemental' | 'fixed_size' | 'stratification',
 *   justification: string,
 *   description?: string,  // For judgemental: what the agent should do
 *   context?: {             // Additional context for better assessment
 *     method?: string,
 *     sampleSize?: number,
 *     populationSize?: number,
 *     threshold?: number,
 *     dataType?: string,
 *     materiality?: number,
 *   }
 * }
 *
 * Returns: {
 *   verdict: 'defensible' | 'potentially_weak' | 'indefensible',
 *   assessment: string,      // Detailed explanation
 *   concerns: string[],      // Specific issues found
 *   suggestions: string[],   // How to improve
 * }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const action = apiAction(req, session.user as { id: string; firmId?: string }, '/api/sampling/assess-justification', 'sampling');

  try {
    const body = await req.json();
    const { type, justification, description, context } = body;

    if (!justification || justification.trim().length < 10) {
      return NextResponse.json({ error: 'Justification must be at least 10 characters' }, { status: 400 });
    }

    action.info('Assessing justification', { type, justificationLength: justification.length });

    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

    let systemPrompt = `You are a senior audit quality reviewer assessing whether a sampling justification would be defensible to an audit regulator (e.g., FRC, PCAOB, IAASB).

Your role is NOT to decide whether the approach is correct. Your role is to assess whether the JUSTIFICATION given is defensible — i.e., would a cold-file reviewer or regulator find the reasoning acceptable?

Classify the justification into exactly one of three categories:
1. "defensible" — The rationale references risk, materiality, assertion-level considerations, or the nature of the population. It demonstrates professional judgement.
2. "potentially_weak" — The rationale has some merit but is missing key elements or could be stronger. Clarification would improve it.
3. "indefensible" — The rationale relies on workload minimisation ("fewer items", "most efficient", "reduced workload"), circular logic ("because it gives an acceptable sample size"), or contains no reference to risk, materiality, or audit objectives.

Return ONLY valid JSON:
{
  "verdict": "defensible" | "potentially_weak" | "indefensible",
  "assessment": "2-3 sentence explanation of your assessment",
  "concerns": ["specific concern 1", "specific concern 2"],
  "suggestions": ["suggestion to improve 1", "suggestion 2"]
}`;

    let userPrompt = '';

    switch (type) {
      case 'composite_threshold':
        userPrompt = `Assess this justification for choosing a composite sampling threshold of ${context?.threshold ? `£${context.threshold.toLocaleString()}` : 'the stated amount'}:

JUSTIFICATION: "${justification}"

Context: Data type is ${context?.dataType || 'unspecified'}, performance materiality is ${context?.materiality ? `£${context.materiality.toLocaleString()}` : 'unspecified'}, population size is ${context?.populationSize || 'unspecified'} items.

Is this justification defensible for the threshold selection?`;
        break;

      case 'judgemental':
        userPrompt = `Assess BOTH the selection criteria AND the justification for this judgemental sampling approach:

SELECTION CRITERIA (what will be done): "${description || 'Not provided'}"

JUSTIFICATION (why this approach): "${justification}"

Context: Data type is ${context?.dataType || 'unspecified'}, sample size is ${context?.sampleSize || 'unspecified'}, population size is ${context?.populationSize || 'unspecified'}.

Assess:
1. Are the selection criteria operational and specific enough to be reproducible?
2. Is the justification defensible to a regulator?`;
        break;

      case 'fixed_size':
        userPrompt = `Assess this justification for choosing a fixed sample size of ${context?.sampleSize || 'N'}:

JUSTIFICATION: "${justification}"

Context: Population size is ${context?.populationSize || 'unspecified'}, data type is ${context?.dataType || 'unspecified'}, performance materiality is ${context?.materiality ? `£${context.materiality.toLocaleString()}` : 'unspecified'}.

Is choosing a fixed sample size (rather than statistically calculated) defensible with this justification?`;
        break;

      case 'stratification':
        userPrompt = `Assess this justification for the chosen stratification approach in audit sampling:

JUSTIFICATION: "${justification}"

Context: Data type is ${context?.dataType || 'unspecified'}, population size is ${context?.populationSize || 'unspecified'}, method is ${context?.method || 'unspecified'}.

Is this stratification rationale defensible to a regulator? Does it demonstrate understanding of why stratification is appropriate for this population?`;
        break;

      default:
        userPrompt = `Assess this audit sampling justification:

JUSTIFICATION: "${justification}"

Is this defensible to an audit regulator?`;
    }

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
        await action.success('Justification assessed', { type, verdict: parsed.verdict });
        return NextResponse.json(parsed);
      } catch { /* fall through */ }
    }

    // Fallback if AI didn't return valid JSON
    await action.warn('AI returned non-JSON assessment', { contentPreview: content.slice(0, 200) });
    return NextResponse.json({
      verdict: 'potentially_weak',
      assessment: 'Could not fully assess the justification. Please review manually.',
      concerns: ['Automated assessment was inconclusive'],
      suggestions: ['Ensure the justification references risk, materiality, and audit objectives'],
    });

  } catch (error) {
    await action.error(error, { stage: 'assess_justification' });
    return action.errorResponse(error);
  }
}
