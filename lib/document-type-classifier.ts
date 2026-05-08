import Anthropic from '@anthropic-ai/sdk';

/**
 * Best-effort document-type guess for an uploaded file. Used by the
 * tab-document and Documents-repo upload routes when the user didn't
 * pre-set a document type. Returns null on any failure (missing API
 * key, network error, model returns junk) — callers should treat null
 * as "no suggestion" and leave the type blank rather than making
 * something up.
 *
 * The model picks from a fixed catalogue mirroring the dropdown the
 * Documents tab shows. If the file genuinely doesn't fit any of them
 * the model is told to return 'Other' so we never invent new types.
 */

export const DOCUMENT_TYPE_CATALOGUE = [
  'Bank Statement',
  'Bank Confirmation',
  'Invoice',
  'Contract',
  'Lease Agreement',
  'Board Minutes',
  'Financial Statements',
  'Tax Return',
  'Payroll Report',
  'Fixed Asset Register',
  'Debtor Listing',
  'Creditor Listing',
  'Stock Listing',
  'Management Accounts',
  'Letter of Representation',
  'Letter of Comment',
  'Engagement Letter',
  'Solicitor Confirmation',
  'Other',
] as const;

export type DocumentTypeCatalogueEntry = (typeof DOCUMENT_TYPE_CATALOGUE)[number];

const SYSTEM_PROMPT =
  `You classify files uploaded into an audit working file. The user has just uploaded a file with the given filename and mime type. Pick the SINGLE best-fit category from the supplied list. If nothing fits, return "Other". Reply with the category name only — no quotes, no explanation, no trailing punctuation.`;

export async function classifyDocumentType(input: {
  fileName: string;
  mimeType?: string | null;
  textSnippet?: string | null;
}): Promise<DocumentTypeCatalogueEntry | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const list = DOCUMENT_TYPE_CATALOGUE.join('\n - ');
  const userParts: string[] = [
    `Filename: ${input.fileName}`,
  ];
  if (input.mimeType) userParts.push(`Mime type: ${input.mimeType}`);
  if (input.textSnippet) userParts.push(`First 1500 characters of the file content:\n${input.textSnippet.slice(0, 1500)}`);
  userParts.push(`Allowed categories:\n - ${list}`);
  userParts.push('Reply with one of the category names exactly. If unsure, reply "Other".');

  try {
    const client = new Anthropic({ apiKey });
    const result = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: 32,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userParts.join('\n\n') }],
    });
    const block = result.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') return null;
    const raw = block.text.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?,;:]+$/, '');
    const matched = DOCUMENT_TYPE_CATALOGUE.find(t => t.toLowerCase() === raw.toLowerCase());
    return matched ?? null;
  } catch (err) {
    console.warn('[document-type-classifier] failed:', err);
    return null;
  }
}
