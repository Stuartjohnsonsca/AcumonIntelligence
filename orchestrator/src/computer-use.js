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
import { askUser } from './acumon.js';

const MODEL = process.env.COMPUTER_USE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_ITERATIONS = 60;
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
      await page.keyboard.type(String(input.text || ''), { delay: 30 });
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

// ─── Main loop ───────────────────────────────────────────────────────

export async function runComputerUseLoop({ page, sessionId, systemPrompt, initialUserMessage, onComplete, onFail }) {
  const viewport = page.viewportSize() || { width: 1280, height: 800 };
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
  ];

  const messages = [{ role: 'user', content: initialUserMessage }];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
      betas: ['computer-use-2025-01-24'],
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      // Claude finished without explicitly calling submit_done. Treat as failure.
      throw new Error('Claude ended the turn without submitting an archive');
    }
    if (response.stop_reason !== 'tool_use') {
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    const toolUses = response.content.filter(b => b.type === 'tool_use');
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
