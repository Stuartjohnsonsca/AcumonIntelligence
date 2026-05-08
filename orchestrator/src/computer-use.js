// Anthropic Computer Use loop bridged to a Playwright Page.
//
// We give Claude two tools:
//   - `computer` (the standard Anthropic computer-use tool)
//     screenshot / left_click / type / key / scroll / etc.
//   - `ask_user` (custom)
//     pause and ask the user something (credentials, MFA, confirmation).
//     The orchestrator queues a prompt via the Acumon internal API and
//     returns the answer here for Claude to use.
//   - `submit_done` (custom)
//     called when Claude considers the task complete; returns the
//     final downloaded file path so the caller can submit_archive it.
//
// Loop: send messages → handle tool calls → loop until Claude returns
// `end_turn` or `submit_done` or we hit the iteration cap.

import Anthropic from '@anthropic-ai/sdk';
import { askUser, reportProgress } from './acumon.js';

const MODEL = process.env.COMPUTER_USE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_ITERATIONS = 60;
// Keep only the N most recent screenshot tool_results in context. Older
// ones get replaced with a tiny text placeholder so Claude still sees the
// shape of history but the API request stays small. Each screenshot is a
// big image — letting them accumulate makes every iteration slower than
// the last.
const MAX_RECENT_SCREENSHOTS = Number(process.env.MAX_RECENT_SCREENSHOTS || 3);
// Computer-use tool versions track Anthropic's spec; bump when we move
// model families.
const COMPUTER_TOOL_TYPE = 'computer_20250124';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ASK_USER_TOOL = {
  name: 'ask_user',
  description:
    'Pause and ask the operator a question (e.g. credentials for the vendor, an MFA code, '
    + '"is this the right client?"). Returns the operator\'s answer. Do NOT use this for '
    + 'questions the operator could not be expected to answer (HTML structure, etc.).',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['credentials', 'mfa', 'confirm', 'select', 'text'] },
      message: { type: 'string' },
      fields: {
        type: 'array',
        description: "For type='credentials': list of fields to ask for, e.g. [{name:'email',label:'Email'}, {name:'password',label:'Password',secret:true}]",
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            label: { type: 'string' },
            secret: { type: 'boolean' },
          },
          required: ['name', 'label'],
        },
      },
      options: {
        type: 'array',
        description: "For type='select': list of options [{value, label}].",
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['value', 'label'],
        },
      },
    },
    required: ['type', 'message'],
  },
};

const SUBMIT_DONE_TOOL = {
  name: 'submit_done',
  description: 'Call when the prior-period audit archive has been downloaded successfully. '
    + 'After this returns, the orchestrator will collect the file from the Downloads '
    + 'folder and submit it back to Acumon.',
  input_schema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Absolute path to the downloaded file inside the orchestrator container.',
      },
    },
    required: ['filePath'],
  },
};

const FAIL_TOOL = {
  name: 'fail',
  description: 'Call if you cannot complete the task and have exhausted reasonable options. '
    + 'Provide a short explanation of what went wrong; the operator will see it.',
  input_schema: {
    type: 'object',
    properties: { reason: { type: 'string' } },
    required: ['reason'],
  },
};

const NAVIGATE_TOOL = {
  name: 'navigate',
  description: 'Navigate the browser tab to a specific URL. The browser is headless so the URL '
    + 'bar is not part of the rendered page — use this tool instead of trying to type into it. '
    + 'Always use absolute URLs (https://...).',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute URL to navigate to.' } },
    required: ['url'],
  },
};

// Convert a Playwright key chord like "Ctrl+a" to Anthropic's format.
// Anthropic computer-use uses xdotool-style strings: "ctrl+a", "Return".
function normaliseKeyChord(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

// ─── Tool execution against a Playwright page ────────────────────────

async function executeComputerAction(page, input) {
  const action = input.action;
  switch (action) {
    case 'screenshot': {
      const png = await page.screenshot({ type: 'png' });
      return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } };
    }
    case 'left_click': {
      const [x, y] = input.coordinate || [0, 0];
      await page.mouse.click(x, y);
      return { type: 'text', text: 'clicked' };
    }
    case 'right_click': {
      const [x, y] = input.coordinate || [0, 0];
      await page.mouse.click(x, y, { button: 'right' });
      return { type: 'text', text: 'right-clicked' };
    }
    case 'double_click': {
      const [x, y] = input.coordinate || [0, 0];
      await page.mouse.dblclick(x, y);
      return { type: 'text', text: 'double-clicked' };
    }
    case 'type': {
      await page.keyboard.type(String(input.text || ''), { delay: 5 });
      return { type: 'text', text: 'typed' };
    }
    case 'key': {
      await page.keyboard.press(normaliseKeyChord(input.text));
      return { type: 'text', text: 'pressed' };
    }
    case 'mouse_move': {
      const [x, y] = input.coordinate || [0, 0];
      await page.mouse.move(x, y);
      return { type: 'text', text: 'moved' };
    }
    case 'scroll': {
      const [x, y] = input.coordinate || [0, 0];
      const dir = input.scroll_direction || 'down';
      const amt = (input.scroll_amount || 3) * 100;
      const dx = dir === 'left' ? -amt : dir === 'right' ? amt : 0;
      const dy = dir === 'up' ? -amt : dir === 'down' ? amt : 0;
      await page.mouse.move(x, y);
      await page.mouse.wheel(dx, dy);
      return { type: 'text', text: 'scrolled' };
    }
    case 'wait': {
      const dur = Math.min(Math.max(parseInt(input.duration, 10) || 1, 1), 10) * 1000;
      await page.waitForTimeout(dur);
      return { type: 'text', text: 'waited' };
    }
    case 'cursor_position': {
      // Playwright doesn't expose cursor position; return centre of viewport.
      const vp = page.viewportSize() || { width: 1280, height: 800 };
      return { type: 'text', text: `${Math.round(vp.width / 2)},${Math.round(vp.height / 2)}` };
    }
    default:
      return { type: 'text', text: `unknown action: ${action}` };
  }
}

// ─── Context pruning ─────────────────────────────────────────────────
//
// Walk the message history and replace screenshot images in older
// tool_results with a 1-line text placeholder, keeping only the
// MAX_RECENT_SCREENSHOTS most recent. The Anthropic API charges per image
// token and re-uploads them every iteration, so without this each turn
// gets ~15 s slower than the last.
function pruneOldScreenshots(messages) {
  // Collect references to image-bearing content arrays in order.
  const imageHolders = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue;
      if (!Array.isArray(block.content)) continue;
      const hasImage = block.content.some(c => c && c.type === 'image');
      if (hasImage) imageHolders.push(block);
    }
  }
  // Keep the last N untouched; redact the rest.
  const cutoff = imageHolders.length - MAX_RECENT_SCREENSHOTS;
  for (let i = 0; i < cutoff; i++) {
    imageHolders[i].content = [{ type: 'text', text: '[older screenshot omitted to save context]' }];
  }
}

// Convert one of Claude's tool_use blocks into a one-line activity
// summary for the operator-facing log + status feed. Keep these short
// and human-readable.
function describeToolUse(tu) {
  if (tu.name === 'computer') {
    const a = tu.input?.action;
    switch (a) {
      case 'screenshot': return 'Looking at the page';
      case 'left_click': return `Clicking at (${tu.input?.coordinate?.[0]},${tu.input?.coordinate?.[1]})`;
      case 'right_click': return `Right-clicking at (${tu.input?.coordinate?.[0]},${tu.input?.coordinate?.[1]})`;
      case 'double_click': return `Double-clicking at (${tu.input?.coordinate?.[0]},${tu.input?.coordinate?.[1]})`;
      case 'type': {
        const t = String(tu.input?.text || '');
        // Don't echo secrets — if it looks long-ish and has no spaces, redact.
        const looksSensitive = t.length >= 6 && !/\s/.test(t);
        return `Typing "${looksSensitive ? '•••' : t.slice(0, 40)}"`;
      }
      case 'key': return `Pressing ${tu.input?.text}`;
      case 'scroll': return `Scrolling ${tu.input?.scroll_direction || 'down'}`;
      case 'wait': return `Waiting ${tu.input?.duration || 1}s`;
      default: return `computer.${a}`;
    }
  }
  if (tu.name === 'navigate') return `Navigating to ${tu.input?.url}`;
  if (tu.name === 'ask_user') return `Asking the operator (${tu.input?.type})`;
  if (tu.name === 'submit_done') return 'Submitting downloaded archive';
  if (tu.name === 'fail') return `Giving up: ${tu.input?.reason || 'no reason'}`;
  return tu.name;
}

// ─── Main loop ───────────────────────────────────────────────────────

export async function runComputerUseLoop({ page, sessionId, systemPrompt, initialUserMessage, onComplete, onFail }) {
  const viewport = page.viewportSize() || { width: 1280, height: 800 };
  // Tag the LAST tool with cache_control:ephemeral so Anthropic caches
  // the entire tools block. The system prompt and tools don't change
  // between iterations, so caching them avoids re-processing ~5 KB of
  // input tokens on every API call. Cuts each iteration by 50-70 %.
  const tools = [
    {
      type: COMPUTER_TOOL_TYPE,
      name: 'computer',
      display_width_px: viewport.width,
      display_height_px: viewport.height,
    },
    ASK_USER_TOOL,
    SUBMIT_DONE_TOOL,
    FAIL_TOOL,
    { ...NAVIGATE_TOOL, cache_control: { type: 'ephemeral' } },
  ];
  // System prompt as a single cached text block (string form doesn't
  // support cache_control).
  const systemBlocks = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ];

  const messages = [{ role: 'user', content: initialUserMessage }];
  // Track the most-recent stage we've inferred from Claude's actions,
  // so the modal's stepper roughly tracks reality even though we don't
  // know with certainty when Claude has "finished logging in".
  let currentStage = 'logging_in';

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    pruneOldScreenshots(messages);
    console.log(`[session ${sessionId}] iter ${iter + 1}/${MAX_ITERATIONS}: thinking…`);
    const t0 = Date.now();
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemBlocks,
      tools,
      messages,
      betas: ['computer-use-2025-01-24', 'prompt-caching-2024-07-31'],
    });
    const usage = response.usage || {};
    console.log(
      `[session ${sessionId}] iter ${iter + 1}: API ${Date.now() - t0}ms, stop=${response.stop_reason}, `
      + `tokens in=${usage.input_tokens || 0} cached_read=${usage.cache_read_input_tokens || 0} cached_write=${usage.cache_creation_input_tokens || 0} out=${usage.output_tokens || 0}`,
    );

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      // Claude finished without explicitly calling submit_done. Treat as failure.
      throw new Error('Claude ended the turn without submitting an archive');
    }
    if (response.stop_reason !== 'tool_use') {
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    const toolUses = response.content.filter(b => b.type === 'tool_use');
    // Surface what Claude is about to do — both to container logs (for
    // the operator running `az containerapp logs show`) and to the
    // modal's progress message (so the user sees a live activity feed).
    if (toolUses.length > 0) {
      const summary = toolUses.map(describeToolUse).join('; ');
      console.log(`[session ${sessionId}] iter ${iter + 1}: ${summary}`);
      // Heuristic stage advancement based on the tool calls Claude is
      // making — once we've seen MFA the user is mid-login; once we
      // see ask_user(select|confirm) the user is past login and Claude
      // is disambiguating clients/periods (i.e. navigating).
      for (const tu of toolUses) {
        if (tu.name === 'ask_user') {
          const t = tu.input?.type;
          if (t === 'select' || t === 'confirm') currentStage = 'navigating';
        } else if (tu.name === 'submit_done') {
          currentStage = 'downloading';
        }
      }
      // Don't await reportProgress — fire-and-forget so a slow Acumon
      // API call can't stall the loop. Drop errors silently.
      reportProgress(sessionId, currentStage, summary).catch(() => {});
    }
    const toolResults = [];
    for (const tu of toolUses) {
      try {
        if (tu.name === 'computer') {
          const result = await executeComputerAction(page, tu.input);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: [result] });
        } else if (tu.name === 'ask_user') {
          const answer = await askUser(sessionId, tu.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: [{ type: 'text', text: JSON.stringify(answer) }],
          });
        } else if (tu.name === 'navigate') {
          try {
            const url = String(tu.input.url || '').trim();
            if (!/^https?:\/\//i.test(url)) {
              throw new Error('navigate requires absolute http(s) URL');
            }
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            toolResults.push({
              type: 'tool_result', tool_use_id: tu.id,
              content: [{ type: 'text', text: `navigated to ${page.url()}` }],
            });
          } catch (err) {
            toolResults.push({
              type: 'tool_result', tool_use_id: tu.id, is_error: true,
              content: [{ type: 'text', text: String(err?.message || err).slice(0, 300) }],
            });
          }
        } else if (tu.name === 'submit_done') {
          await onComplete(tu.input);
          return;
        } else if (tu.name === 'fail') {
          await onFail(tu.input.reason || 'Failed (no reason given)');
          return;
        } else {
          toolResults.push({
            type: 'tool_result', tool_use_id: tu.id, is_error: true,
            content: [{ type: 'text', text: `Unknown tool: ${tu.name}` }],
          });
        }
      } catch (err) {
        toolResults.push({
          type: 'tool_result', tool_use_id: tu.id, is_error: true,
          content: [{ type: 'text', text: String(err?.message || err).slice(0, 500) }],
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }
  throw new Error(`Hit max iterations (${MAX_ITERATIONS}) without completion`);
}
