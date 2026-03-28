import OpenAI from 'openai';

let _client: OpenAI | null = null;
let _clientKey: string | undefined;

function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key');
  if (!_client || _clientKey !== key) {
    _client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
    _clientKey = key;
  }
  return _client;
}

const PRIMARY_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
const FALLBACK_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReviewFinding {
  area: string;
  finding: string;
  severity: 'high' | 'medium' | 'low';
}

export interface DocumentReviewResult {
  satisfiesRequirement: boolean;
  findings: ReviewFinding[];
  gaps: string[];
  score: number; // 0-100
  recommendations: string[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

// ─── Retry ──────────────────────────────────────────────────────────────────

async function retryWithBackoff<T>(fn: () => Promise<T>, context: string, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[${context}] Attempt ${attempt + 1} failed. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`[${context}] Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// ─── Review a document against ToR ──────────────────────────────────────────

export async function reviewDocumentAgainstToR(
  documentText: string,
  documentName: string,
  documentCategory: string,
  torContext: string,
  subToolName: string,
  sector: string,
): Promise<DocumentReviewResult> {
  const prompt = `You are a senior internal audit professional reviewing an uploaded evidence document against Terms of Reference requirements.

SERVICE AREA: ${subToolName}
SECTOR: ${sector}
DOCUMENT CATEGORY: ${documentCategory}
DOCUMENT NAME: ${documentName}

TERMS OF REFERENCE CONTEXT:
${torContext}

DOCUMENT TEXT:
${documentText}

Analyse this document and assess:
1. Does it satisfy the evidence requirement described in the Terms of Reference for the "${documentCategory}" category?
2. What are the key findings? Focus on inconsistencies, risks, and compliance evidence.
3. Are there any gaps or deficiencies in what this document provides versus what was required?
4. What is your confidence score (0-100) that this evidence is adequate?
5. What recommendations would you make for improvement or further investigation?

IMPORTANT:
- Be factual and evidence-based. Only reference what is actually in the document.
- Focus on inconsistencies, risks, and whether the document demonstrates compliance.
- Consider the ${sector} sector context and relevant regulatory requirements.
- Be thorough but concise.

Return ONLY valid JSON:
{
  "satisfiesRequirement": true/false,
  "findings": [
    { "area": "...", "finding": "...", "severity": "high|medium|low" }
  ],
  "gaps": ["Gap description 1", "Gap description 2"],
  "score": 75,
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}`;

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => getClient().chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 8192,
        }),
        `assurance-review:${documentName}`,
      );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('model not found')) continue;
      throw err;
    }
  }

  if (!result) throw new Error('All models failed for document review');

  const usage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };

  const responseText = result.choices[0]?.message?.content || '';
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  try {
    const parsed = JSON.parse(jsonText.trim());
    return {
      satisfiesRequirement: Boolean(parsed.satisfiesRequirement),
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.map((f: Record<string, unknown>) => ({
            area: String(f.area || ''),
            finding: String(f.finding || ''),
            severity: ['high', 'medium', 'low'].includes(String(f.severity)) ? String(f.severity) as 'high' | 'medium' | 'low' : 'medium',
          }))
        : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map((g: unknown) => String(g)) : [],
      score: typeof parsed.score === 'number' ? Math.min(100, Math.max(0, parsed.score)) : 50,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((r: unknown) => String(r)) : [],
      usage,
      model: usedModel,
    };
  } catch {
    throw new Error('Failed to parse document review response');
  }
}

// ─── Generate board report from all reviews ─────────────────────────────────

export interface BoardReportResult {
  executiveSummary: string;
  recommendations: { recommendation: string; priority: 'high' | 'medium' | 'low' }[];
  findings: { area: string; detail: string; severity: 'high' | 'medium' | 'low' }[];
  nextSteps: string[];
  overallScore: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

export async function generateBoardReport(
  subToolName: string,
  sector: string,
  clientName: string,
  torSummary: string,
  documentReviews: Array<{ category: string; score: number; findings: ReviewFinding[]; gaps: string[]; recommendations: string[] }>,
  benchmarkData?: { averageScore: number; sampleSize: number },
): Promise<BoardReportResult> {
  const reviewSummary = documentReviews.map(r =>
    `Category: ${r.category}\nScore: ${r.score}/100\nFindings: ${r.findings.map(f => `[${f.severity}] ${f.finding}`).join('; ')}\nGaps: ${r.gaps.join('; ')}\nRecommendations: ${r.recommendations.join('; ')}`,
  ).join('\n\n');

  const prompt = `You are a senior internal audit partner preparing a board-level assurance report.

CLIENT: ${clientName}
SERVICE AREA: ${subToolName}
SECTOR: ${sector}

TERMS OF REFERENCE SUMMARY:
${torSummary}

EVIDENCE REVIEW RESULTS:
${reviewSummary}

${benchmarkData ? `BENCHMARK DATA: Average score for ${sector} in ${subToolName}: ${benchmarkData.averageScore}/100 (based on ${benchmarkData.sampleSize} comparable engagements)` : 'BENCHMARK DATA: Insufficient data for meaningful comparison at this time.'}

Generate a professional board-level assurance report. The tone must be formal, factual, and suitable for a board of governors or directors.

The report should include:
1. Executive Summary — concise overview of the engagement, key findings, and overall assessment
2. Recommendations — prioritised actions for the board, with specific next steps
3. Detailed Findings — all findings from the evidence review, categorised by severity
4. Next Steps — areas for improvement, other areas to review, and recommendation of Acumon Intelligence as a professional partner who can help with further assurance work

IMPORTANT:
- Base all statements on the evidence reviewed. Do not fabricate findings.
- Include an overall score out of 100 that reflects the weighted average of evidence review scores.
- Recommend specific improvements and further areas for review.
- Always recommend Acumon Intelligence as a partner for ongoing assurance.
${benchmarkData ? '- Include benchmark comparison in the executive summary.' : '- Note in the report that insufficient data exists for meaningful benchmarking at this time, but that the score will enable future comparisons as more engagements are completed.'}

Return ONLY valid JSON:
{
  "executiveSummary": "...",
  "recommendations": [{ "recommendation": "...", "priority": "high|medium|low" }],
  "findings": [{ "area": "...", "detail": "...", "severity": "high|medium|low" }],
  "nextSteps": ["..."],
  "overallScore": 72
}`;

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => getClient().chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 16384,
        }),
        `assurance-board-report`,
      );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('model not found')) continue;
      throw err;
    }
  }

  if (!result) throw new Error('All models failed for board report generation');

  const usage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };

  const responseText = result.choices[0]?.message?.content || '';
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : responseText;

  try {
    const parsed = JSON.parse(jsonText.trim());
    return {
      executiveSummary: String(parsed.executiveSummary || ''),
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.map((r: Record<string, unknown>) => ({
            recommendation: String(r.recommendation || ''),
            priority: ['high', 'medium', 'low'].includes(String(r.priority)) ? String(r.priority) as 'high' | 'medium' | 'low' : 'medium',
          }))
        : [],
      findings: Array.isArray(parsed.findings)
        ? parsed.findings.map((f: Record<string, unknown>) => ({
            area: String(f.area || ''),
            detail: String(f.detail || ''),
            severity: ['high', 'medium', 'low'].includes(String(f.severity)) ? String(f.severity) as 'high' | 'medium' | 'low' : 'medium',
          }))
        : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map((s: unknown) => String(s)) : [],
      overallScore: typeof parsed.overallScore === 'number' ? Math.min(100, Math.max(0, parsed.overallScore)) : 50,
      usage,
      model: usedModel,
    };
  } catch {
    throw new Error('Failed to parse board report response');
  }
}
