import Anthropic from '@anthropic-ai/sdk';
import type { SourceFile } from './source-locator';
import type { NetworkRequestRecord, ConsoleEntry } from './redactor';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

export interface ClaudeFileChange {
  path: string;            // repo-relative
  newContents: string;     // ENTIRE new file contents (Claude rewrites the file)
  rationale: string;
}

export interface ClaudeAnalysisResult {
  analysis: string;
  fileChanges: ClaudeFileChange[];
  noFixReason?: string;
}

export interface AnalyzeInput {
  source: 'user_reported' | 'auto_detected';
  userDescription?: string | null;
  superAdminMessage?: string | null;
  url?: string | null;
  httpStatus?: number | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  network: NetworkRequestRecord[];
  consoleErrors: ConsoleEntry[];
  sources: SourceFile[];
}

const SYSTEM_PROMPT = `You are an expert TypeScript/Next.js engineer. You have been given an error from a production audit-management web app and the source files most likely related to it. Your job is to:

1. Diagnose the root cause concisely.
2. Decide whether you can confidently propose a fix from the information you have.
3. If yes, return COMPLETE replacement contents for the affected files. Do NOT return partial diffs — return the entire file. Only modify what is necessary; preserve everything else byte-for-byte.

Hard constraints:
- Be conservative. If unsure, set noFixReason and return zero fileChanges.
- Never modify env files, schema.prisma, or anything in node_modules.
- Never weaken auth checks.
- Never delete files.
- Keep changes minimal — fix the bug only, do not refactor.
- Each file you change MUST exist in the sources you were given. Do NOT invent paths.`;

const TOOL = {
  name: 'propose_fix',
  description: 'Return your diagnosis and (optionally) file changes that fix the error.',
  input_schema: {
    type: 'object' as const,
    properties: {
      analysis: {
        type: 'string',
        description: 'Concise root-cause diagnosis (1-3 sentences).',
      },
      noFixReason: {
        type: 'string',
        description: 'If you cannot confidently propose a fix, explain why. Leave empty if you ARE proposing a fix.',
      },
      fileChanges: {
        type: 'array',
        description: 'List of files to overwrite. Empty array if no fix is proposed.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repo-relative path. MUST match a path from the input sources.' },
            newContents: { type: 'string', description: 'COMPLETE new file contents.' },
            rationale: { type: 'string', description: 'Why this change fixes the error.' },
          },
          required: ['path', 'newContents', 'rationale'],
        },
      },
    },
    required: ['analysis', 'fileChanges'],
  },
};

export async function analyzeError(input: AnalyzeInput): Promise<ClaudeAnalysisResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const userParts: string[] = [];
  userParts.push(`### Error source: ${input.source}`);
  if (input.url) userParts.push(`### URL\n${input.url}`);
  if (input.httpStatus != null) userParts.push(`### HTTP status\n${input.httpStatus}`);
  if (input.errorMessage) userParts.push(`### Error message\n${input.errorMessage}`);
  if (input.errorStack) userParts.push(`### Stack\n\`\`\`\n${input.errorStack.slice(0, 4000)}\n\`\`\``);
  if (input.userDescription) userParts.push(`### User description\n${input.userDescription}`);
  if (input.superAdminMessage) userParts.push(`### Reporter's message to admins\n${input.superAdminMessage}`);

  if (input.consoleErrors.length > 0) {
    const c = input.consoleErrors.slice(-10).map((e) => `[${e.level}] ${e.message}${e.stack ? '\n' + e.stack.slice(0, 500) : ''}`).join('\n---\n');
    userParts.push(`### Recent console errors (last ${Math.min(10, input.consoleErrors.length)})\n${c}`);
  }

  if (input.network.length > 0) {
    const n = input.network.slice(-10).map((r) => {
      const status = r.status ?? '???';
      const dur = r.durationMs ? `${r.durationMs}ms` : '?';
      return `${r.method} ${r.url} → ${status} (${dur})${r.errorMessage ? ' ERR=' + r.errorMessage : ''}`;
    }).join('\n');
    userParts.push(`### Recent network (last ${Math.min(10, input.network.length)})\n${n}`);
  }

  if (input.sources.length > 0) {
    userParts.push('### Source files');
    for (const s of input.sources) {
      userParts.push(`#### \`${s.path}\`\n\`\`\`\n${s.contents}\n\`\`\``);
    }
  } else {
    userParts.push('### Source files\n(none located — propose no fix unless you can suggest a generic safe change)');
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'propose_fix' },
    messages: [{ role: 'user', content: userParts.join('\n\n') }],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a tool_use block');
  }

  const result = toolUse.input as {
    analysis: string;
    noFixReason?: string;
    fileChanges: ClaudeFileChange[];
  };

  // Defensive: filter to only files that were in the input sources, prevent invented paths
  const allowedPaths = new Set(input.sources.map((s) => s.path));
  const safeChanges = (result.fileChanges || []).filter((c) => allowedPaths.has(c.path));

  return {
    analysis: result.analysis || '(no analysis returned)',
    fileChanges: safeChanges,
    noFixReason: result.noFixReason,
  };
}
