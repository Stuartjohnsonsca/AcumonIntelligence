/**
 * Render pipeline for document templates.
 *
 *   body (Handlebars HTML)  →  Handlebars  →  filled HTML
 *                           →  html-to-docx  →  OOXML body fragment
 *                           →  docxtemplater → final .docx (with skeleton)
 *
 * The firm-uploaded skeleton .docx must contain the raw-XML tag
 * `{@body}` (note the @) at the point where the rendered body should
 * appear. docxtemplater replaces that tag with the fragment as raw
 * XML so the body is rendered inline, not escaped.
 */

import { prisma } from '@/lib/db';
import { buildTemplateContext } from '@/lib/template-context';
import { renderBody, extractReferencedPaths } from '@/lib/template-handlebars';
import { htmlToDocxBody } from '@/lib/template-html-to-docx';
import { contextHasPath, buildSampleContext } from '@/lib/template-merge-fields';

// Dynamic imports for server-only packages (docxtemplater + pizzip
// use Node APIs that must not be bundled into client chunks).
async function loadDocxtemplater() {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
    import('pizzip') as any,
    import('docxtemplater') as any,
  ]);
  return { PizZip, Docxtemplater };
}

export interface RenderResult {
  buffer: Buffer;
  fileName: string;
  skeletonName: string;
  templateName: string;
}

/**
 * Produce a .docx Buffer for a given template + engagement. Throws
 * with a clear message on any unrecoverable error — callers map the
 * message to a 4xx/5xx response.
 */
export async function renderTemplateToDocx(templateId: string, engagementId: string): Promise<RenderResult> {
  const template = await prisma.documentTemplate.findUnique({
    where: { id: templateId },
    include: { skeleton: true, firm: { select: { name: true } } },
  });
  if (!template) throw new Error('Template not found');
  if (template.kind !== 'document') throw new Error('Template kind must be "document" to render as Word');
  const skeleton = template.skeleton ?? await pickDefaultSkeleton(template.firmId, template.auditType);
  if (!skeleton) throw new Error('No firm skeleton attached to this template and no default skeleton exists for this firm / audit type. Upload one first.');

  // 1. Build live context from the engagement.
  const context = await buildTemplateContext(engagementId);

  // 2. Handlebars render the body.
  const bodyHtml = template.content || '';
  const { html, error: hbError } = renderBody(bodyHtml, context);
  if (hbError) throw new Error(`Template render failed: ${hbError}`);

  // 3. Convert the rendered HTML into a docx body XML fragment.
  const bodyXml = htmlToDocxBody(html);

  // 4. Load skeleton from blob + run docxtemplater to inject `{@body}`.
  const { downloadBlob } = await import('@/lib/azure-blob');
  const skeletonBuffer = await downloadBlob(skeleton.storagePath, skeleton.containerName);
  const { PizZip, Docxtemplater } = await loadDocxtemplater();
  const zip = new PizZip(skeletonBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  // docxtemplater v3 expects `.render({...data})` and raw XML via
  // `{@tag}` auto-detect when parser is default. We pass the XML
  // directly — docxtemplater recognises the @ prefix.
  try {
    doc.render({ body: bodyXml });
  } catch (err: any) {
    const detail = err?.properties?.errors
      ? err.properties.errors.map((e: any) => e.properties?.explanation || e.message).join('; ')
      : (err?.message || 'docxtemplater render failed');
    throw new Error(`Skeleton stitching failed: ${detail}. Make sure the skeleton contains a literal {@body} tag.`);
  }
  const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  const fileNameSafe = `${slugify(template.name)}__${slugify(context.client.name)}__${context.period.periodEnd || 'period'}.docx`;
  return { buffer, fileName: fileNameSafe, skeletonName: skeleton.name, templateName: template.name };
}

/**
 * Preview: run Handlebars only, return HTML + the list of referenced
 * paths that aren't in the live or sample context. No docx produced.
 * Used by the admin preview pane to iterate quickly on the body.
 */
export interface PreviewResult {
  html: string;
  error: string | null;
  missingPlaceholders: string[];
  usedLiveContext: boolean;
}

export async function previewTemplate(
  templateId: string,
  engagementId: string | null,
): Promise<PreviewResult> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error('Template not found');

  let context: any;
  let usedLiveContext = false;
  if (engagementId) {
    try {
      context = await buildTemplateContext(engagementId);
      usedLiveContext = true;
    } catch {
      context = buildSampleContext();
    }
  } else {
    context = buildSampleContext();
  }

  const bodyHtml = template.content || '';
  const referenced = extractReferencedPaths(bodyHtml);
  const missing = referenced.filter(p => !contextHasPath(context, p));
  const { html, error } = renderBody(bodyHtml, context);
  return { html, error, missingPlaceholders: missing, usedLiveContext };
}

/** Return the default skeleton for a firm+auditType, falling back to
 *  any default skeleton for ALL audit types, then any active skeleton
 *  at all. Null if the firm has nothing uploaded. */
async function pickDefaultSkeleton(firmId: string, auditType: string) {
  const candidates = await prisma.firmDocumentSkeleton.findMany({
    where: { firmId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return candidates.find(s => s.isDefault && s.auditType === auditType)
    || candidates.find(s => s.isDefault && s.auditType === 'ALL')
    || candidates.find(s => s.auditType === auditType)
    || candidates.find(s => s.auditType === 'ALL')
    || candidates[0]
    || null;
}

/** Simple filename slug — strips anything that isn't filename-safe. */
function slugify(s: string): string {
  return String(s || 'file').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
}

/**
 * Probe a skeleton .docx to make sure it contains a `{@body}` tag.
 * Used by the upload endpoint to reject skeletons that would render
 * into nothing and confuse the admin.
 */
export async function skeletonHasBodyPlaceholder(buffer: Buffer): Promise<boolean> {
  const { PizZip } = await loadDocxtemplater();
  try {
    const zip = new PizZip(buffer);
    const doc = zip.file('word/document.xml');
    if (!doc) return false;
    const xml = doc.asText();
    // Word can wrap `{@body}` across multiple runs; check both exact
    // and a more tolerant regex that allows runs between the braces.
    if (xml.includes('{@body}')) return true;
    return /\{[^}]*@[^}]*body[^}]*\}/.test(xml);
  } catch {
    return false;
  }
}
