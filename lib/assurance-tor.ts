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

const PRIMARY_MODEL = 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo';
const FALLBACK_MODEL = 'Qwen/Qwen2.5-72B-Instruct-Turbo';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToRSection {
  title: string;
  content: string;
}

export interface EvidenceChecklistItem {
  category: string;
  description: string;
  required: boolean;
}

export interface TermsOfReferenceResult {
  sections: ToRSection[];
  evidenceChecklist: EvidenceChecklistItem[];
  keyRisks: string[];
  estimatedDuration: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

// ─── Retry (shared pattern) ─────────────────────────────────────────────────

async function retryWithBackoff<T>(fn: () => Promise<T>, context: string, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[${context}] Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`[${context}] Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// ─── Generate Terms of Reference ────────────────────────────────────────────

export async function generateTermsOfReference(
  subTool: string,
  subToolName: string,
  sector: string,
  projectDetails: Record<string, string>,
  chatHistory?: string,
): Promise<TermsOfReferenceResult> {
  const prompt = `You are generating a professional Terms of Reference document for an internal audit engagement.

SERVICE AREA: ${subToolName}
CLIENT SECTOR: ${sector}
PROJECT DETAILS: ${JSON.stringify(projectDetails)}
${chatHistory ? `\nCONVERSATION CONTEXT:\n${chatHistory}` : ''}

Generate a comprehensive Terms of Reference following the IIA Global Internal Audit Standards and best practices for the ${sector} sector.

The document MUST include these sections:
1. Executive Summary — Brief overview of the engagement purpose and scope
2. Background and Context — Why this engagement is being undertaken, relevant sector considerations for ${sector}
3. Objectives — What the engagement aims to achieve
4. Scope — Processes, systems, locations, time period under review
5. Methodology and Approach — How the work will be conducted, sampling approach, testing strategy
6. Key Risk Areas and Controls to Test — Specific risks relevant to ${subToolName} in the ${sector} sector
7. Required Evidence and Documentation — List of specific documents needed for review
8. Timeline and Milestones — Proposed schedule for the engagement phases
9. Reporting Structure — How findings will be reported, who will receive the report
10. Quality Assurance — Review and sign-off procedures

For section 7 (Required Evidence), generate a SPECIFIC checklist of documents that will need to be uploaded as evidence. Each item should have:
- A category name (used for file upload tagging)
- A description of what the document should contain
- Whether it is required or optional

IMPORTANT: Tailor ALL content to the ${sector} sector and ${subToolName} focus area. Reference specific:
- Regulatory frameworks applicable to ${sector}
- Industry standards and best practices
- Common risks and control weaknesses in this sector
- Relevant compliance requirements

Return ONLY valid JSON with this exact structure:
{
  "sections": [
    { "title": "Executive Summary", "content": "..." },
    { "title": "Background and Context", "content": "..." },
    ...
  ],
  "evidenceChecklist": [
    { "category": "Governance Framework", "description": "Copy of the organisation's AI governance framework or policy document", "required": true },
    { "category": "Risk Register", "description": "Current risk register showing AI/technology related risks", "required": true },
    ...
  ],
  "keyRisks": ["Risk description 1", "Risk description 2", ...],
  "estimatedDuration": "4-6 weeks"
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
        `assurance-tor:${subTool}`,
      );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('model not found')) continue;
      throw err;
    }
  }

  if (!result) throw new Error('All models failed for ToR generation');

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

    const sections: ToRSection[] = Array.isArray(parsed.sections)
      ? parsed.sections.map((s: Record<string, unknown>) => ({
          title: String(s.title || ''),
          content: String(s.content || ''),
        }))
      : [];

    const evidenceChecklist: EvidenceChecklistItem[] = Array.isArray(parsed.evidenceChecklist)
      ? parsed.evidenceChecklist.map((e: Record<string, unknown>) => ({
          category: String(e.category || ''),
          description: String(e.description || ''),
          required: Boolean(e.required),
        }))
      : [];

    const keyRisks: string[] = Array.isArray(parsed.keyRisks)
      ? parsed.keyRisks.map((r: unknown) => String(r))
      : [];

    console.log(
      `[Assurance:ToR] Generated | subTool=${subTool} | sector=${sector} | sections=${sections.length} | evidence=${evidenceChecklist.length} | risks=${keyRisks.length}`,
    );

    return {
      sections,
      evidenceChecklist,
      keyRisks,
      estimatedDuration: String(parsed.estimatedDuration || '4-6 weeks'),
      usage,
      model: usedModel,
    };
  } catch (parseError) {
    console.error(`[Assurance:ToR] JSON parse failed: ${parseError instanceof Error ? parseError.message : 'Unknown'}`);
    throw new Error('Failed to parse ToR AI response');
  }
}
