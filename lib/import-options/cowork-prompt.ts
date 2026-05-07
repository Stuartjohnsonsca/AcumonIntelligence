// Builds the prompt the user pastes into their AI browser assistant
// (Claude.ai with the Claude in Chrome extension is the reference setup,
// but we keep the user-facing copy generic so it works with any
// extension-based browsing assistant). The assistant drives the user's
// actual browser tab — no credentials are ever sent to acumon, no API
// integration to MyWorkPapers etc., no ToS issues. We just write the
// prompt; the user runs it.

export interface CoworkPromptInput {
  vendorLabel: string; // e.g. "MyWorkPapers", "CaseWare Cloud"
  clientName: string;
  /** ISO YYYY-MM-DD. */
  periodEnd?: string;
  auditTypeLabel?: string; // "SME audit (FRS102)", etc.
}

// Prompt for the **connected** (MCP) flow. Includes the session token
// inline so the assistant can use it as the bearer when calling our MCP
// server. The user does not need to copy the token themselves — this
// prompt is auto-opened in claude.ai via URL prefill (and copied to
// clipboard as a fallback for browsers that block the prefill).
export function buildHandoffPrompt(args: {
  vendorLabel: string;
  mcpEndpoint: string;
  sessionToken: string;
}): string {
  return [
    `Run an Acumon Audit Import session on the "Acumon Audit Import" MCP server registered in your settings.`,
    '',
    `MCP endpoint: ${args.mcpEndpoint}`,
    `Bearer token (for this session only): ${args.sessionToken}`,
    `Vendor: ${args.vendorLabel}`,
    '',
    `Steps:`,
    `1. Call get_session_context first to read the engagement details (client name, period end).`,
    `2. Drive my open browser tab to ${args.vendorLabel}. If I am not yet logged in, pause and ask me to log in — do NOT enter passwords or MFA codes for me.`,
    `3. Navigate to the client and prior period from step 1.`,
    `4. Find the option to download the engagement archive (zip preferred; otherwise the financial statements + key working papers PDF).`,
    `5. Call submit_archive with the downloaded file. The session closes after this; do not call further tools.`,
    '',
    `Avoid any state-changing actions in ${args.vendorLabel} — read-only navigation + the download click only.`,
  ].join('\n');
}

export function buildCoworkPrompt(input: CoworkPromptInput): string {
  const periodLine = input.periodEnd
    ? `Period end: ${input.periodEnd}`
    : 'Period end: (find the most recent completed audit period)';
  const typeLine = input.auditTypeLabel
    ? `Audit type: ${input.auditTypeLabel}`
    : '';

  return [
    `I'm starting a new audit engagement and I need the prior period audit file from ${input.vendorLabel}.`,
    '',
    'Please use the Chrome browser tab I have open (you should see the page with the cursor) to:',
    '',
    `1. Make sure you are logged in to ${input.vendorLabel}. If not, ask me to log in — I will do it manually so you do not need my password.`,
    `2. Navigate to the client called: ${input.clientName}.`,
    `3. Open the prior period audit file. ${periodLine}`,
    typeLine ? `   ${typeLine}` : '',
    '4. Find the option to download the engagement archive (often labelled "Download", "Export", or "Archive"). Use the most complete export available — preferably a zip of the whole engagement, otherwise a PDF of the financial statements + key working papers.',
    '5. Save the file to my Downloads folder.',
    '',
    'When the download finishes, tell me the filename and where you saved it. I will pick it up from there and continue in my audit tool.',
    '',
    'Important rules:',
    '- Do NOT enter any password or 2FA code on my behalf. If a login is needed, pause and ask me.',
    '- Do NOT click anything that looks like "Delete", "Archive engagement", "Sign off", or any state-changing action. Read-only navigation + the download action only.',
    '- If you cannot find the prior period or the export option, stop and describe what you see; I will take over.',
  ].filter(Boolean).join('\n');
}
