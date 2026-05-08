// One end-to-end import session: Playwright launches Chromium, Claude
// drives it via Computer Use, downloaded file is submitted back.

import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { runComputerUseLoop } from './computer-use.js';
import { reportProgress, reportFailure, fetchRecipe, saveRecipe, submitArchive } from './acumon.js';

const VIEWPORT = { width: 1280, height: 800 };

function buildSystemPrompt({ vendorLabel, clientName, recipe }) {
  return [
    `You are an audit assistant operating a real Chromium browser to import a prior-period audit file from ${vendorLabel} on behalf of an auditor.`,
    '',
    `The auditor wants the prior period file for client: ${clientName || 'TBD — confirm with the user'}.`,
    '',
    'Procedure:',
    '1. Use the `computer` tool to take screenshots and click through the vendor\'s site.',
    '2. If the site needs a login, call `ask_user` with type="credentials" listing the fields needed (e.g. email + password). DO NOT attempt to guess. The operator will reply via the tool.',
    '3. If the site challenges with MFA, call `ask_user` with type="mfa".',
    '4. Navigate to the client and the most recent CLOSED prior audit period.',
    '5. If you are unsure which client / period is correct, call `ask_user` with type="confirm" or type="select" to disambiguate.',
    '6. Find the option to download the engagement archive (zip preferred; otherwise the financial statements + working papers PDF).',
    '7. Wait for the download to complete. The browser is configured so downloads land in /tmp/downloads inside this container.',
    '8. Call `submit_done` with the absolute file path. Do NOT call any other tool after that.',
    '',
    'Hard rules:',
    '- NEVER click anything that looks destructive (delete, archive, sign-off, finalise, lock).',
    '- NEVER navigate away from the vendor\'s site once logged in.',
    '- If you cannot complete the task after several retries, call `fail` with a short explanation.',
    '',
    recipe ? `Saved recipe for this client (use as a guide; verify selectors still apply): ${JSON.stringify(recipe.data).slice(0, 2000)}` : 'No saved recipe for this client yet — discover the path from the live UI.',
  ].join('\n');
}

export async function runSession({ sessionId, vendorLabel, clientName }) {
  console.log(`[session ${sessionId}] starting (vendor=${vendorLabel}, client=${clientName})`);
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

    await reportProgress(sessionId, 'launching_browser', `Browser launched. Loading ${vendorLabel}…`);
    // Best-effort: navigate to a sensible starting URL (vendor name as a
    // search query). Claude can navigate from there. We deliberately do
    // NOT hard-code MyWorkPapers' URL — claude figures it out and we
    // capture into the recipe.
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(vendorLabel + ' login')}`, { waitUntil: 'domcontentloaded' }).catch(() => {});

    const recipe = await fetchRecipe(sessionId, clientName || 'unknown').catch(() => null);

    let donePayload = null;
    let failed = false;
    await runComputerUseLoop({
      page,
      sessionId,
      systemPrompt: buildSystemPrompt({ vendorLabel, clientName, recipe }),
      initialUserMessage: `Begin. Vendor: ${vendorLabel}. Client: ${clientName || '(ask the operator)'}.`,
      onComplete: async (input) => { donePayload = input; },
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

    // Persist a recipe for future runs of this client. We don't have a
    // structured recipe yet — first version is just the URL we ended on,
    // a screenshot-derived hint, and the path we took. Subsequent
    // refinement is future work.
    try {
      const finalUrl = page.url();
      await saveRecipe(sessionId, clientName || 'unknown', {
        version: 1,
        finalUrl,
        observedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[session] saveRecipe failed:', err.message);
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
