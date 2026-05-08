// Prompt template the operator copy-pastes into Claude Cowork.
//
// Cowork is the user's own browser-resident agent — it can drive both
// the vendor site (where the user is already signed in / handles MFA
// themselves) and the Acumon tab (where the file gets dropped into the
// import modal's upload area). Acumon has no special API for this; the
// existing /api/engagements/[id]/import-options/upload endpoint accepts
// `sourceType=claude_cowork` and processes the file the same way as a
// manual upload, just tagged with the vendor label.
//
// Iterate the prompt freely here — the modal renders whatever this
// returns; no other code paths read its contents.

export interface CoworkPromptInputs {
  vendorLabel: string;
  loginUrl?: string;       // optional — vendor login URL if known
  clientName: string;
  periodEnd?: string;      // ISO date 'YYYY-MM-DD'
  auditTypeLabel?: string; // human-readable (e.g. "Statutory Audit")
  acumonReturnLabel: string; // visible browser-tab label / title for Acumon
}

export function buildCoworkPrompt(input: CoworkPromptInputs): string {
  const {
    vendorLabel,
    loginUrl,
    clientName,
    periodEnd,
    auditTypeLabel,
    acumonReturnLabel,
  } = input;

  return [
    `Please help me import a prior-period audit archive into Acumon from ${vendorLabel}.`,
    '',
    'Step 1 — Open the vendor:',
    loginUrl
      ? `- Open ${loginUrl} in a new tab.`
      : `- Open ${vendorLabel} in a new tab.`,
    "- I'm already signed in or will sign in myself. If MFA is required, I'll handle it.",
    '',
    'Step 2 — Find the right engagement:',
    `- Client: ${clientName}`,
    auditTypeLabel ? `- Audit type: ${auditTypeLabel}` : null,
    periodEnd ? `- Period ending: ${periodEnd}` : null,
    '- Open the most recent CLOSED prior-period engagement matching this client and period.',
    '',
    'Step 3 — Download the archive:',
    '- Use the vendor\'s "Download archive", "Export engagement", or equivalent option.',
    '- Prefer a ZIP. If no archive option exists, download the financial statements PDF and the working-papers PDF together.',
    '- Save the file(s) to my computer.',
    '',
    'Step 4 — Return to Acumon:',
    `- Switch back to the Acumon tab titled "${acumonReturnLabel}".`,
    '- The "Use Claude Cowork" panel has a file drop zone — drag the downloaded file into it (or use the file picker).',
    '- Wait for Acumon to confirm the upload, then stop. I\'ll review the AI extraction myself.',
    '',
    'Important:',
    '- Do NOT change anything in the vendor system — read/download only.',
    '- Do NOT click finalise / sign-off / archive / delete buttons.',
    '- If you get stuck or the page looks unexpected, pause and ask me before continuing.',
  ].filter(Boolean).join('\n');
}
