import OpenAI from 'openai';
import { prisma } from '@/lib/db';

// ─── Client ─────────────────────────────────────────────────────────────────

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

const PRIMARY_MODEL = 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
const FALLBACK_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExtractedPattern {
  patternType: 'routing_pattern' | 'common_concern' | 'sector_insight' | 'successful_approach';
  pattern: string;
  sector?: string;
  subTool?: string;
}

// ─── Extract learnings from a resolved chat ─────────────────────────────────

export async function extractLearningsFromChat(chatId: string): Promise<ExtractedPattern[]> {
  const chat = await prisma.assuranceChat.findUnique({
    where: { id: chatId },
    include: {
      messages: { orderBy: { turnOrder: 'asc' } },
      engagement: true,
      client: { select: { sector: true } },
    },
  });

  if (!chat || chat.status === 'active') return [];

  const conversation = chat.messages
    .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
    .join('\n');

  const prompt = `Analyse this completed assurance advisory conversation and extract reusable patterns that can help improve future conversations.

CONVERSATION:
${conversation}

OUTCOME:
- Resolved to sub-tool: ${chat.subTool || 'None (booking requested)'}
- Client sector: ${chat.client?.sector || 'Unknown'}
${chat.engagement ? `- Engagement type: ${chat.engagement.engagementType}` : ''}

Extract patterns in these categories:
1. **routing_pattern** — What key phrases, concerns, or topics reliably indicated this sub-tool was the right choice? What was the user really asking about?
2. **common_concern** — What specific concerns did the user raise that are likely common across similar organisations or sectors?
3. **sector_insight** — What sector-specific context was important for guiding this conversation effectively?
4. **successful_approach** — What questioning approach or information-gathering strategy worked well in this conversation?

RULES:
- Only extract genuinely useful, reusable patterns — not trivial observations.
- Each pattern should be a concise, actionable insight (1-2 sentences).
- Do not include personally identifiable information about the client.
- Focus on patterns that would help the AI advisor handle similar future conversations more efficiently.
- Extract 2-6 patterns total. Quality over quantity.

Return ONLY valid JSON:
{
  "patterns": [
    {
      "patternType": "routing_pattern",
      "pattern": "When users mention concerns about AI bias in hiring decisions, this maps to Meritocracy & Diversity rather than AI Governance.",
      "sector": "Technology",
      "subTool": "Diversity"
    }
  ]
}`;

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let result: OpenAI.Chat.Completions.ChatCompletion | null = null;

  for (const modelId of models) {
    try {
      result = await getClient().chat.completions.create({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('404') || msg.includes('model not found')) continue;
      console.error(`[Assurance:Feedback] Model ${modelId} failed:`, err);
      continue;
    }
  }

  if (!result) return [];

  const responseText = result.choices[0]?.message?.content || '';
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[1].trim());
    if (!Array.isArray(parsed.patterns)) return [];

    return parsed.patterns
      .filter((p: Record<string, unknown>) => p.patternType && p.pattern)
      .map((p: Record<string, unknown>) => ({
        patternType: String(p.patternType),
        pattern: String(p.pattern),
        sector: p.sector ? String(p.sector) : undefined,
        subTool: p.subTool ? String(p.subTool) : undefined,
      }));
  } catch {
    console.error('[Assurance:Feedback] Failed to parse extraction response');
    return [];
  }
}

// ─── Store learnings in the database ────────────────────────────────────────

export async function storeLearnings(firmId: string, patterns: ExtractedPattern[]): Promise<number> {
  let stored = 0;

  for (const pattern of patterns) {
    // Check for existing similar pattern (same firm, type, and sub-tool)
    const existing = await prisma.assuranceLearning.findFirst({
      where: {
        firmId,
        patternType: pattern.patternType,
        subTool: pattern.subTool || null,
        sector: pattern.sector || null,
      },
      orderBy: { confidence: 'desc' },
    });

    if (existing) {
      // Check if this is a genuinely new pattern vs a reinforcement of existing one
      const isSimilar = await checkPatternSimilarity(existing.pattern, pattern.pattern);

      if (isSimilar) {
        // Reinforce existing pattern — increase confidence and source count
        await prisma.assuranceLearning.update({
          where: { id: existing.id },
          data: {
            confidence: Math.min(1.0, existing.confidence + 0.1),
            sourceCount: existing.sourceCount + 1,
            lastSeenAt: new Date(),
          },
        });
        stored++;
        continue;
      }
    }

    // Store as new learning
    await prisma.assuranceLearning.create({
      data: {
        firmId,
        sector: pattern.sector || null,
        subTool: pattern.subTool || null,
        patternType: pattern.patternType,
        pattern: pattern.pattern,
        confidence: 0.5,
        sourceCount: 1,
      },
    });
    stored++;
  }

  return stored;
}

// ─── Check if two patterns are semantically similar ─────────────────────────

async function checkPatternSimilarity(existing: string, candidate: string): Promise<boolean> {
  // Quick heuristic: if significant word overlap, consider similar
  const existingWords = new Set(existing.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const candidateWords = new Set(candidate.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  let overlap = 0;
  for (const word of candidateWords) {
    if (existingWords.has(word)) overlap++;
  }

  const similarity = overlap / Math.max(existingWords.size, candidateWords.size);
  return similarity > 0.4; // 40% word overlap = likely the same pattern
}

// ─── Retrieve relevant learnings for a chat context ─────────────────────────

export async function getRelevantLearnings(
  firmId: string,
  sector?: string | null,
  subTool?: string | null,
  limit: number = 10,
): Promise<string> {
  const learnings = await prisma.assuranceLearning.findMany({
    where: {
      firmId,
      confidence: { gte: 0.4 }, // Only use patterns with reasonable confidence
      OR: [
        // Exact match for sector and sub-tool
        ...(sector && subTool ? [{ sector, subTool }] : []),
        // Match sector, any sub-tool
        ...(sector ? [{ sector, subTool: null }] : []),
        // Match sub-tool, any sector
        ...(subTool ? [{ sector: null, subTool }] : []),
        // Universal patterns
        { sector: null, subTool: null },
      ],
    },
    orderBy: [
      { confidence: 'desc' },
      { sourceCount: 'desc' },
      { lastSeenAt: 'desc' },
    ],
    take: limit,
  });

  if (learnings.length === 0) return '';

  const grouped: Record<string, string[]> = {};
  for (const l of learnings) {
    const key = l.patternType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(`- ${l.pattern} (confidence: ${Math.round(l.confidence * 100)}%, seen ${l.sourceCount}x)`);
  }

  const sections: string[] = [];

  if (grouped.routing_pattern) {
    sections.push(`ROUTING INSIGHTS (learned from past conversations):\n${grouped.routing_pattern.join('\n')}`);
  }
  if (grouped.common_concern) {
    sections.push(`COMMON CONCERNS in this context:\n${grouped.common_concern.join('\n')}`);
  }
  if (grouped.sector_insight) {
    sections.push(`SECTOR-SPECIFIC INSIGHTS:\n${grouped.sector_insight.join('\n')}`);
  }
  if (grouped.successful_approach) {
    sections.push(`EFFECTIVE APPROACHES:\n${grouped.successful_approach.join('\n')}`);
  }

  return `\n\nLEARNED FROM PREVIOUS CONVERSATIONS:\n${sections.join('\n\n')}\n\nUse these insights to guide your conversation more effectively, but always adapt to the specific user's needs.`;
}

// ─── Process feedback for a completed chat ──────────────────────────────────

export async function processChatFeedback(chatId: string, firmId: string): Promise<{ patternsStored: number }> {
  try {
    const patterns = await extractLearningsFromChat(chatId);
    if (patterns.length === 0) return { patternsStored: 0 };

    const stored = await storeLearnings(firmId, patterns);
    console.log(`[Assurance:Feedback] Extracted and stored ${stored} patterns from chat ${chatId}`);
    return { patternsStored: stored };
  } catch (err) {
    console.error('[Assurance:Feedback] Error processing feedback:', err);
    return { patternsStored: 0 };
  }
}

// ─── Decay old patterns that haven't been seen recently ─────────────────────

export async function decayOldPatterns(firmId: string, daysThreshold: number = 90): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);

  // Reduce confidence of patterns not seen recently
  const stalePatterns = await prisma.assuranceLearning.findMany({
    where: {
      firmId,
      lastSeenAt: { lt: cutoff },
      confidence: { gt: 0.1 },
    },
  });

  let decayed = 0;
  for (const pattern of stalePatterns) {
    const newConfidence = Math.max(0.1, pattern.confidence - 0.15);
    await prisma.assuranceLearning.update({
      where: { id: pattern.id },
      data: { confidence: newConfidence },
    });
    decayed++;
  }

  // Delete patterns with very low confidence and low source count
  await prisma.assuranceLearning.deleteMany({
    where: {
      firmId,
      confidence: { lt: 0.15 },
      sourceCount: { lt: 3 },
      lastSeenAt: { lt: cutoff },
    },
  });

  return decayed;
}

// ─── Integrate human feedback into learning loop ────────────────────────────

export async function applyHumanFeedback(firmId: string, chatId: string): Promise<void> {
  // Get all human feedback for this chat
  const feedback = await prisma.assuranceFeedback.findMany({
    where: { chatId, firmId },
  });

  if (feedback.length === 0) return;

  // Get the chat's resolved sub-tool and sector
  const chat = await prisma.assuranceChat.findUnique({
    where: { id: chatId },
    include: { client: { select: { sector: true } } },
  });
  if (!chat) return;

  // Count feedback sentiment
  const helpful = feedback.filter(f => f.rating === 'helpful').length;
  const unhelpful = feedback.filter(f => f.rating === 'unhelpful').length;
  const needsImprovement = feedback.filter(f => f.rating === 'needs_improvement').length;

  // Calculate net sentiment: positive boosts, negative reduces
  const netSentiment = (helpful * 0.1) - (unhelpful * 0.15) - (needsImprovement * 0.05);

  // Apply to learnings derived from this chat's context
  const learnings = await prisma.assuranceLearning.findMany({
    where: {
      firmId,
      OR: [
        { subTool: chat.subTool || undefined },
        { sector: chat.client?.sector || undefined },
      ],
    },
  });

  for (const learning of learnings) {
    const newConfidence = Math.max(0.05, Math.min(1.0, learning.confidence + netSentiment));
    await prisma.assuranceLearning.update({
      where: { id: learning.id },
      data: { confidence: newConfidence },
    });
  }

  // If there are written feedback comments, extract additional patterns
  const comments = feedback
    .filter(f => f.comment && f.comment.trim().length > 10)
    .map(f => `[${f.rating}]: ${f.comment}`);

  if (comments.length > 0) {
    const commentContext = comments.join('\n');
    // Include human feedback in the next pattern extraction
    console.log(`[Assurance:Feedback] Applied human feedback from ${feedback.length} entries for chat ${chatId}. Net sentiment: ${netSentiment.toFixed(2)}`);

    // Store direct human insights as high-confidence patterns
    for (const fb of feedback.filter(f => f.comment && f.comment.trim().length > 20)) {
      const patternType = fb.rating === 'unhelpful' ? 'common_concern' : 'successful_approach';
      await prisma.assuranceLearning.create({
        data: {
          firmId,
          sector: chat.client?.sector || null,
          subTool: chat.subTool || null,
          patternType,
          pattern: `[Human feedback] ${fb.comment}`,
          confidence: 0.7, // Human feedback starts with higher confidence
          sourceCount: 1,
        },
      });
    }
  }
}

// ─── Enhanced processChatFeedback that includes human feedback ───────────────

export async function processChatFeedbackWithHumanInput(chatId: string, firmId: string): Promise<{ patternsStored: number }> {
  // First, apply any human feedback to existing patterns
  await applyHumanFeedback(firmId, chatId);

  // Then run the normal pattern extraction
  return processChatFeedback(chatId, firmId);
}
