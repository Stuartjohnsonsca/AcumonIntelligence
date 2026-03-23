import OpenAI from 'openai';

// Lazy-initialised client — reads the current env var on each call.
let _client: OpenAI | null = null;
let _clientKey: string | undefined;

function getClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key: set TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY');
  if (!_client || _clientKey !== key) {
    _client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
    _clientKey = key;
  }
  return _client;
}

const PRIMARY_MODEL = 'Qwen/Qwen3.5-397B-A17B';
const FALLBACK_MODEL = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssuranceChatResponse {
  content: string;
  metadata: {
    recommendedSubTool?: string; // Governance | CyberResiliance | TalentRisk | ESGSustainability | Diversity
    shouldBook?: boolean;
    projectDetails?: Record<string, string>;
  };
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ─── Pricing ────────────────────────────────────────────────────────────────

const PRICING: Record<string, { inputPerToken: number; outputPerToken: number }> = {
  [PRIMARY_MODEL]: { inputPerToken: 0.60 / 1_000_000, outputPerToken: 3.60 / 1_000_000 },
  [FALLBACK_MODEL]: { inputPerToken: 0.27 / 1_000_000, outputPerToken: 0.85 / 1_000_000 },
};

const DEFAULT_PRICING = { inputPerToken: 0.60 / 1_000_000, outputPerToken: 3.60 / 1_000_000 };

export function calculateAssuranceCost(
  usage: { promptTokens: number; completionTokens: number },
  model: string,
): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  return (usage.promptTokens * pricing.inputPerToken) + (usage.completionTokens * pricing.outputPerToken);
}

// ─── Retry logic (mirrors doc-summary-ai.ts) ───────────────────────────────

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate') || msg.includes('quota')
      || msg.includes('500') || msg.includes('503') || msg.includes('unavailable')
      || msg.includes('resource exhausted') || msg.includes('timeout')
      || msg.includes('econnreset') || msg.includes('fetch failed');
  }
  return false;
}

function parseRetryDelay(errorMessage: string): number | null {
  const match = errorMessage.match(/retry\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  const msMatch = errorMessage.match(/retry\s+(?:in\s+)?(\d+)\s*ms/i);
  if (msMatch) return parseInt(msMatch[1], 10);
  return null;
}

function addJitter(delayMs: number): number {
  const jitter = delayMs * (Math.random() * 0.25);
  return Math.round(delayMs + jitter);
}

async function retryWithBackoff<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isTransientError(err) && attempt === 0) {
        throw new Error(`[${context}] Non-transient error: ${lastError.message}`);
      }
      if (attempt < MAX_RETRIES - 1) {
        const serverDelay = parseRetryDelay(lastError.message);
        const exponentialDelay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        const rawDelay = serverDelay ?? exponentialDelay;
        const clampedDelay = Math.min(Math.max(rawDelay, BASE_BACKOFF_MS), MAX_BACKOFF_MS);
        const finalDelay = addJitter(clampedDelay);
        console.warn(
          `[${context}] Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${finalDelay}ms...`,
        );
        await new Promise(r => setTimeout(r, finalDelay));
      }
    }
  }
  throw new Error(`[${context}] Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

function isModelUnavailableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (msg.includes('404') && (msg.includes('model') || msg.includes('unable to access')))
      || msg.includes('model not found')
      || msg.includes('does not exist');
  }
  return false;
}

// ─── System Prompts ─────────────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a senior internal audit and assurance advisor at Acumon Intelligence, a professional services firm specialising in AI-powered assurance and internal audit.

Your role is to understand the client's concerns and determine which of the following 5 assurance services is most appropriate:

1. **Agentic AI & Governance** — AI governance frameworks, algorithmic accountability, AI risk management, model validation, ethical AI, automation controls
2. **Cyber Risk** — Cybersecurity resilience, data protection, IT general controls, penetration testing, incident response, GDPR/data privacy
3. **Workforce & Talent Risk** — HR controls, succession planning, skills gaps, labour compliance, employee wellbeing, workplace safety
4. **ESG & Sustainability** — Environmental/social/governance reporting, carbon footprint, sustainability frameworks, climate risk, social impact
5. **Meritocracy & Diversity** — DEI assurance, pay equity, equal opportunities, inclusion metrics, bias detection, fair recruitment practices

IMPORTANT INSTRUCTIONS:
- Start by understanding the user's situation. Ask probing questions to understand their concerns.
- Do NOT recommend a service until you have enough context — ask at least 2-3 clarifying questions first.
- Be professional, concise, and helpful. Use clear language.
- When you are confident which service fits, include a JSON block at the END of your response in this exact format:
  \`\`\`json
  {"recommendedSubTool": "Governance"}
  \`\`\`
  Use EXACTLY one of these values: Governance, CyberResiliance, TalentRisk, ESGSustainability, Diversity

- If NONE of the 5 services clearly fits after thorough discussion, include:
  \`\`\`json
  {"shouldBook": true}
  \`\`\`
  And suggest a meeting with our specialist to discuss their requirements further.

- You may also capture project details as you learn them by including:
  \`\`\`json
  {"projectDetails": {"scope": "...", "timeline": "...", "stakeholders": "..."}}
  \`\`\`

- Only include JSON when you have a recommendation or booking suggestion. For regular conversational messages, just respond naturally.`;

function buildDrillDownSystemPrompt(subToolName: string): string {
  return `You are a senior internal audit specialist at Acumon Intelligence, focused on ${subToolName}.

The user has been directed to the ${subToolName} service. Your job is to drill into the specifics of their project to capture tailoring details.

Ask about the following areas (not all at once — have a natural conversation):
- **Scope**: What departments, business units, or geographies are in scope?
- **Standards/Frameworks**: What regulatory or industry standards apply? (e.g., ISO 27001, NIST, GRI, IIA Standards)
- **Specific Concerns**: Are there particular risk areas or incidents that prompted this engagement?
- **Timeline**: When does the assurance work need to be completed?
- **Stakeholders**: Who will receive the report? (Board, Audit Committee, Regulators)
- **Previous Reviews**: Has there been any prior internal audit or assurance work in this area?
- **Data Availability**: What documentation and evidence will be available?

As you gather information, include a JSON block with the project details captured so far:
\`\`\`json
{"projectDetails": {"scope": "...", "frameworks": "...", "concerns": "...", "timeline": "...", "stakeholders": "...", "previousReviews": "...", "dataAvailability": "..."}}
\`\`\`

When you have gathered enough detail, let the user know you have enough information to proceed and ask which action they would like to take:
1. Terms of Reference prepared
2. Help with sample testing
3. Duplicate transaction investigation

Be professional, concise, and thorough. Guide the conversation efficiently.`;
}

// ─── Main Chat Function ─────────────────────────────────────────────────────

export async function processAssuranceChat(
  history: ChatMessage[],
  userMessage: string,
  mode: 'triage' | 'drill_down',
  subTool?: string,
  learnedContext?: string,
): Promise<AssuranceChatResponse> {
  let systemPrompt = mode === 'triage'
    ? TRIAGE_SYSTEM_PROMPT
    : buildDrillDownSystemPrompt(subTool || 'Internal Audit');

  // Inject learned patterns from past conversations
  if (learnedContext) {
    systemPrompt += learnedContext;
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20), // Keep last 20 turns for context
    { role: 'user', content: userMessage },
  ];

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let usedModel = models[0];
  const errors: string[] = [];

  for (const modelId of models) {
    usedModel = modelId;
    try {
      result = await retryWithBackoff(
        () => getClient().chat.completions.create({
          model: modelId,
          messages,
          max_tokens: 4096,
        }),
        `assurance-chat:${mode}`,
      );
      console.log(`[Assurance:Chat] Success | mode=${mode} | model=${modelId}`);
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${errMsg}`);
      console.warn(`[Assurance:Chat] Model ${modelId} failed: ${errMsg}`);
      if (isModelUnavailableError(err)) continue;
      if (err instanceof Error && err.message.includes('400')) continue;
      throw err;
    }
  }

  if (!result) {
    throw new Error(`[assurance-chat:${mode}] All models failed. ${errors.join(' | ')}`);
  }

  const usage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };

  const responseText = result.choices[0]?.message?.content || '';

  // Extract structured metadata from JSON blocks in the response
  const metadata: AssuranceChatResponse['metadata'] = {};
  const jsonMatches = responseText.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g);
  for (const match of jsonMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.recommendedSubTool) metadata.recommendedSubTool = parsed.recommendedSubTool;
      if (parsed.shouldBook) metadata.shouldBook = parsed.shouldBook;
      if (parsed.projectDetails) metadata.projectDetails = parsed.projectDetails;
    } catch {
      // Ignore malformed JSON blocks
    }
  }

  // Remove JSON blocks from the display content
  const cleanContent = responseText.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '').trim();

  return {
    content: cleanContent,
    metadata,
    usage,
    model: usedModel,
  };
}

// ─── Sub-tool display name mapping ──────────────────────────────────────────

export const SUB_TOOL_NAMES: Record<string, string> = {
  Governance: 'Agentic AI & Governance',
  CyberResiliance: 'Cyber Risk',
  TalentRisk: 'Workforce & Talent Risk',
  ESGSustainability: 'ESG & Sustainability',
  Diversity: 'Meritocracy & Diversity',
};

export const SUB_TOOL_KEYS = Object.keys(SUB_TOOL_NAMES);
