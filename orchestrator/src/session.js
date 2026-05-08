// One end-to-end import session: Playwright launches Chromium, Claude
// drives it via Computer Use, downloaded file is submitted back.

import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { runComputerUseLoop, summariseRecipe } from './computer-use.js';
import { reportProgress, reportFailure, fetchRecipe, saveRecipe, submitArchive } from './acumon.js';

const VIEWPORT = { width: 1280, height: 800 };

function buildSystemPrompt({ vendorLabel, clientName, recipe }) {
  const knownUrl = recipe?.data?.loginUrl || recipe?.data?.finalUrl;
  const isStructuredV2 = recipe?.data?.version === 2 && Array.isArray(recipe?.data?.loginSteps);
  return [
    `You are operating a headless Chromium to import a prior-period audit file from ${vendorLabel} on behalf of an auditor.`,
    `Client: ${clientName || 'TBD — confirm with the operator'}.`,
    '',
    '════════════════════════════════════════════════════════════════',
    'ABSOLUTE PROHIBITIONS — violating these will fail the task:',
    '',
    '1. DO NOT navigate to google.com, bing.com, duckduckgo.com or ANY search engine. They block headless browsers with reCAPTCHA.',
    '2. DO NOT attempt to solve a reCAPTCHA, hCaptcha, Cloudflare Turnstile, or any "I am not a robot" challenge. If you encounter one, call `fail` with reason "anti-bot challenge".',
    '3. DO NOT guess vendor URLs. If you don\'t have one, ASK via `ask_user` (type="text").',
    '4. DO NOT type any password or MFA code you invented or remembered. Only type values you obtained via `ask_user` in THIS session.',
    '5. DO NOT click anything destructive (delete, archive, sign-off, finalise, lock, deactivate).',
    '════════════════════════════════════════════════════════════════',
    '',
    'Procedure (in order):',
    knownUrl
      ? `STEP 1: Call the \`navigate\` tool with url="${knownUrl}". Take a screenshot to confirm the page loaded.`
      : `STEP 1: The browser is currently on about:blank. Your VERY FIRST tool call MUST be \`ask_user\` with type="text" and message="What is the login URL for ${vendorLabel}? Paste the full https:// URL." — DO NOT take a screenshot first, DO NOT search anywhere, DO NOT use the navigate tool with a guessed URL. The operator's answer will be the URL; pass it to \`navigate\`.`,
    'STEP 2: After navigating, take ONE screenshot. Call `ask_user` with type="credentials" listing the fields the page actually shows (typically [{name:"email",label:"Email"},{name:"password",label:"Password",secret:true}]).',
    'STEP 3: Type the credentials returned, click the submit/login button. Do NOT screenshot between every keystroke — type the full email, then the full password, then click login, THEN screenshot once to check the result.',
    'STEP 4: If the site challenges with MFA, FIRST trigger the code if needed: many MFA pages require clicking a "Send code", "Email me a code", "Send via email" or similar button before the operator receives the email. If you see such a button, click it and confirm the page acknowledges the code was sent (e.g. "We\'ve emailed you a code"). ONLY after the code is in flight should you call `ask_user` with type="mfa". If the page already auto-sends the code on arrival (no button visible), prompt immediately. Codes expire fast — do not stall on extra screenshots once the code is sent.',
    'STEP 5: Once logged in, find the client. If multiple matches or unsure, call `ask_user` with type="confirm" or type="select".',
    'STEP 6: Open the most recent CLOSED prior audit period. Same disambiguation rule.',
    'STEP 7: Find the option to download the engagement archive (zip preferred, else financial statements + working papers PDF).',
    'STEP 8: Wait for download. Files land in /tmp/acumon-dl-* inside this container.',
    'STEP 9: Call `submit_done` with the absolute file path. STOP — do not call any other tool after this.',
    '',
    'If you ever get blocked, stuck, or unsure for more than 2 screenshots, call `ask_user` rather than guess.',
    '',
    'SPEED: Each screenshot adds ~10 s of API latency. Take a screenshot only when you genuinely need to inspect the page (after a navigation, after a click that changes state, before deciding which element to interact with). Do NOT screenshot between consecutive keystrokes or after every micro-action — group actions, then verify.',
    '',
    isStructuredV2
      ? [
          '════════════════════════════════════════════════════════════════',
          'PROVEN RECIPE for this vendor — a previous successful run recorded',
          'the path that worked. Follow it step-by-step. The selectorHints',
          'describe the visible label/role/text of the element, not raw CSS;',
          'find a matching element on the live page. approxCoords are a',
          'fallback if the label has changed. If a step genuinely doesn\'t',
          'match what you see, fall back to discovery (screenshot + reason)',
          'and call ask_user if you are stuck for more than 2 turns.',
          '',
          `Recipe (vendor=${vendorLabel}, used ${recipe.successCount || 1}× successfully):`,
          JSON.stringify(recipe.data, null, 2).slice(0, 3000),
          '════════════════════════════════════════════════════════════════',
        ].join('\n')
      : recipe
        ? `Saved recipe (legacy v1, only partial info): ${JSON.stringify(recipe.data).slice(0, 800)}`
        : 'No saved recipe for this vendor yet — this run will record the steps that work for future runs.',
  ].join('\n');
}

export async function runSession({ sessionId, vendorLabel, clientName, auditType, periodEnd }) {
  console.log(`[session ${sessionId}] starting (vendor=${vendorLabel}, client=${clientName}, auditType=${auditType}, periodEnd=${periodEnd})`);
  // Surface progress even before Chromium is up — the modal will see
  // 'launching_browser' the moment we start, instead of sitting on
  // 'created' if the launch hangs.
  try { await reportProgress(sessionId, 'launching_browser', 'Starting browser…'); }
  catch (err) { console.warn(`[session ${sessionId}] initial reportProgress failed:`, err.message); }

  let browser = null;
  let context = null;
  let downloadsDir = null;
  const completedDownloads = [];

  try {
    downloadsDir = await mkdtemp(path.join(tmpdir(), 'acumon-dl-'));
    console.log(`[session ${sessionId}] downloads dir: ${downloadsDir}`);

    // Container-friendly Chromium flags. --disable-dev-shm-usage is the
    // load-bearing one: Container Apps gives us a tiny /dev/shm (64 MB)
    // and Chrome refuses to start when its shared-memory needs exceed it.
    // Together with --no-sandbox these match the Playwright-recommended
    // flags for running headless Chromium inside an unprivileged container.
    browser = await chromium.launch({
      headless: true,
      timeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    console.log(`[session ${sessionId}] chromium launched`);
    context = await browser.newContext({
      viewport: VIEWPORT,
      acceptDownloads: true,
      locale: 'en-GB',
    });
    const page = await context.newPage();
    console.log(`[session ${sessionId}] page open`);

    // Track downloads so submit_done can pick the right file.
    page.on('download', async (download) => {
      const filename = download.suggestedFilename();
      const target = path.join(downloadsDir, filename);
      await download.saveAs(target);
      completedDownloads.push({ path: target, name: filename });
    });

    await reportProgress(sessionId, 'launching_browser', `Browser launched. Asking for ${vendorLabel} URL…`);
    // Start on a blank page. We deliberately do NOT navigate to a search
    // engine first — Google et al. reject headless browsers with reCAPTCHA.
    // The system prompt instructs Claude to either use a saved recipe URL
    // or ask the user for the vendor login URL via the ask_user tool.
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});

    // Recipes are stored per-vendor (not per-client) so the first
    // successful import for ANY client unlocks fast paths for all
    // subsequent clients of the same vendor. The recipe summariser is
    // instructed to skip per-client info; the search-for-this-client
    // step is provided fresh on each run via the initial user message.
    const RECIPE_KEY_FOR_VENDOR = '__vendor__';
    const recipe = await fetchRecipe(sessionId, RECIPE_KEY_FOR_VENDOR).catch(() => null);

    let donePayload = null;
    let doneMessages = null;  // captured for post-success recipe summarisation
    let failed = false;
    const targetBits = [
      `Vendor: ${vendorLabel}`,
      `Client: ${clientName || '(ask the operator)'}`,
      auditType ? `Audit type: ${auditType}` : null,
      periodEnd ? `Looking for the period ENDING ${periodEnd} (i.e. the audit for the year ended ${periodEnd}). When you reach the client's engagement list, pick the engagement matching this period — do NOT ask the operator to disambiguate if there is exactly one match.` : null,
    ].filter(Boolean).join('. ');
    await runComputerUseLoop({
      page,
      sessionId,
      systemPrompt: buildSystemPrompt({ vendorLabel, clientName, recipe }),
      initialUserMessage: `Begin. ${targetBits}.`,
      onComplete: async (input, messages) => { donePayload = input; doneMessages = messages; },
      onFail: async (reason) => { failed = true; await reportFailure(sessionId, reason); },
    });

    if (failed) return;
    if (!donePayload || !donePayload.filePath) {
      await reportFailure(sessionId, 'submit_done was called without a filePath');
      return;
    }

    // Read the file Claude said it downloaded. Prefer the explicit path,
    // fall back to the most recent in our downloads directory.
    let buffer;
    let usedPath = donePayload.filePath;
    try {
      buffer = await readFile(usedPath);
    } catch {
      const last = completedDownloads[completedDownloads.length - 1];
      if (!last) throw new Error(`No download found at ${usedPath} or in downloads dir`);
      buffer = await readFile(last.path);
      usedPath = last.path;
    }

    const fileName = path.basename(usedPath);
    const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : fileName.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';

    await submitArchive(sessionId, { fileBuffer: buffer, fileName, mimeType });

    // Persist a structured recipe for future runs. We ask Claude to
    // distil the message history into a JSON recipe describing the path
    // (login URL, login form steps, MFA trigger, navigation pattern,
    // download buttons). The next run for the same vendor gets this
    // injected into its system prompt so it can follow the proven path.
    try {
      const finalUrl = page.url();
      console.log(`[session ${sessionId}] summarising recipe for vendor=${vendorLabel}…`);
      const recipeData = await summariseRecipe({
        messages: doneMessages || [],
        vendorLabel,
        finalUrl,
      });
      await saveRecipe(sessionId, RECIPE_KEY_FOR_VENDOR, {
        version: 2,
        finalUrl,
        observedAt: new Date().toISOString(),
        ...recipeData,
      });
      console.log(`[session ${sessionId}] recipe saved (${Object.keys(recipeData).length} top-level keys)`);
    } catch (err) {
      console.warn(`[session ${sessionId}] recipe summarisation failed:`, err.message);
    }
  } catch (err) {
    console.error('[session] error:', err);
    try { await reportFailure(sessionId, String(err?.message || err).slice(0, 500)); }
    catch (e) { console.error('[session] reportFailure also failed:', e); }
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (downloadsDir) await rm(downloadsDir, { recursive: true, force: true }).catch(() => {});
  }
}
