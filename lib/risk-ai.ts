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

const PRIMARY_MODEL = 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo';
const FALLBACK_MODEL = 'Qwen/Qwen2.5-72B-Instruct-Turbo';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RiskChatResponse {
  content: string;
  metadata: {
    commitmentType?: string; // user_activity | system_work | auditor_work | software_dev
    actionPlan?: {
      title: string;
      summary: string;
      commitmentType: string;
      tasks: Array<{
        taskNumber: number;
        description: string;
        responsible: string;
        deadline: string;
        deliverable: string;
        guidance?: string;
      }>;
    };
    shouldBook?: boolean;
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

export function calculateRiskCost(
  usage: { promptTokens: number; completionTokens: number },
  model: string,
): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  return (usage.promptTokens * pricing.inputPerToken) + (usage.completionTokens * pricing.outputPerToken);
}

// ─── Retry logic ────────────────────────────────────────────────────────────

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

// ─── System Prompt ──────────────────────────────────────────────────────────

const LYRA_SYSTEM_PROMPT = `You are Lyra, a senior risk advisory AI at Acumon Intelligence. You provide high-value, detailed assurance support for large companies on risk management matters.

Your opening message should be: "How can I help you with your risk concerns today?"

YOUR ROLE:
You help users identify and address risk concerns by guiding them through a structured conversation. Your goal is to understand their risk issue and produce a comprehensive action plan.

CONVERSATION FLOW:
1. DISCOVERY — Ask 2-4 probing questions to understand:
   - What is the risk area or concern? (operational, financial, compliance, strategic, IT, reputational)
   - What is the scope? (department, business unit, geography, process)
   - What is the urgency or trigger? (incident, regulatory requirement, board request, proactive review)
   - What resources are available? (internal team, documents, systems access)

2. CLASSIFICATION — Based on the conversation, determine which commitment type best fits:
   a) **User Activity** — The user needs to do risk work themselves, with guidance from the system. Examples: prepare a risk register, check compliance with agreed processes, review a specific control, complete a risk assessment questionnaire.
   b) **System Work** — The AI system should complete work autonomously. Examples: review procedure manuals for control weaknesses, analyse policy documents for gaps, scan financial data for anomalies, benchmark controls against frameworks.
   c) **Professional Auditor Work** — A qualified Acumon professional should be engaged. Examples: form an independent opinion on processes, conduct interviews with management, perform substantive testing, provide formal assurance opinions.
   d) **Software Development** — Custom software should be developed to manage the risk on an ongoing basis. Examples: build a risk dashboard, create automated monitoring alerts, develop a compliance tracking system, build a risk scoring model.

3. ACTION PLAN — Once you have enough information, produce a structured action plan. Include this as a JSON block at the END of your response:

\`\`\`json
{
  "commitmentType": "user_activity",
  "actionPlan": {
    "title": "Risk Assessment Action Plan",
    "summary": "Brief description of what this plan addresses",
    "commitmentType": "user_activity",
    "tasks": [
      {
        "taskNumber": 1,
        "description": "Detailed description of the task",
        "responsible": "User / Acumon System / Acumon Professional / User's Team",
        "deadline": "Within 5 business days",
        "deliverable": "What will be produced",
        "guidance": "Specific guidance or documents to reference"
      }
    ]
  }
}
\`\`\`

IMPORTANT RULES:
- Be professional, authoritative, and helpful. You are a senior risk advisor.
- Ask probing questions before jumping to a solution — understand the full picture first.
- Do NOT produce an action plan until you have asked at least 2-3 clarifying questions and understand the situation.
- When you produce the action plan, set realistic deadlines relative to today.
- Each task should have a clear deliverable and responsible party.
- For "User Activity" tasks, provide detailed guidance on what to do and reference relevant standards/frameworks.
- For "System Work" tasks, describe what the AI system will do and what inputs it needs.
- For "Professional Auditor Work" tasks, describe the scope and expected outputs.
- For "Software Development" tasks, describe the functionality and integration requirements.
- If the matter doesn't clearly fit any category after discussion, suggest booking a meeting with an Acumon specialist:
  \`\`\`json
  {"shouldBook": true}
  \`\`\`
- Only include JSON when you have a recommendation or action plan. For regular conversational messages, just respond naturally.
- Keep responses concise but thorough. Use bullet points and structure where appropriate.`;

// ─── Main Chat Function ─────────────────────────────────────────────────────

export async function processRiskChat(
  history: ChatMessage[],
  userMessage: string,
): Promise<RiskChatResponse> {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: LYRA_SYSTEM_PROMPT },
    ...history.slice(-20),
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
        'risk-chat',
      );
      console.log(`[Risk:Chat] Success | model=${modelId}`);
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${errMsg}`);
      console.warn(`[Risk:Chat] Model ${modelId} failed: ${errMsg}`);
      if (isModelUnavailableError(err)) continue;
      if (err instanceof Error && err.message.includes('400')) continue;
      throw err;
    }
  }

  if (!result) {
    throw new Error(`[risk-chat] All models failed. ${errors.join(' | ')}`);
  }

  const usage = {
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  };

  const responseText = result.choices[0]?.message?.content || '';

  // Extract structured metadata from JSON blocks in the response
  const metadata: RiskChatResponse['metadata'] = {};
  const jsonMatches = responseText.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g);
  for (const match of jsonMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.commitmentType) metadata.commitmentType = parsed.commitmentType;
      if (parsed.actionPlan) metadata.actionPlan = parsed.actionPlan;
      if (parsed.shouldBook) metadata.shouldBook = parsed.shouldBook;
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

// ─── Commitment type display names ──────────────────────────────────────────

export const COMMITMENT_TYPE_NAMES: Record<string, string> = {
  user_activity: 'User Activity',
  system_work: 'System Work',
  auditor_work: 'Professional Auditor',
  software_dev: 'Software Development',
};
