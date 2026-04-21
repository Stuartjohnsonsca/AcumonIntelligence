/**
 * Minimal HTML → OOXML (docx body-fragment) converter.
 *
 * The output is a string of `<w:p>` / `<w:tbl>` elements that slots
 * straight into a .docx file via docxtemplater's raw-XML (`{@body}`)
 * tag. The firm skeleton retains its header / footer / page setup;
 * this fragment becomes the body flow.
 *
 * Scope: handles the subset of HTML the contentEditable editor in
 * `DocumentTemplateEditor` can produce:
 *   Inline:  <strong>/<b>, <em>/<i>, <u>, <s>, <br>, <span>, <a>
 *   Block:   <p>, <div>, <h1>/<h2>/<h3>/<h4>, <hr>, page-break
 *   Lists:   <ul>, <ol>, <li>
 *   Tables:  <table>, <tr>, <th>, <td>
 *   Alignment via `style="text-align:..."` or `align="..."` attribute
 *
 * Everything else falls through as plain text inside a paragraph —
 * safer than silently dropping content.
 */

// ─── XML helpers ───────────────────────────────────────────────────────────
function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ─── Tiny HTML tokeniser ───────────────────────────────────────────────────
// We avoid an npm HTML parser — the editor produces well-behaved
// markup and we don't need full HTML5 compliance.

type Token = { type: 'open' | 'close' | 'void' | 'text'; tag?: string; attrs?: Record<string, string>; text?: string };

function tokenise(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)\/?>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > lastIndex) {
      const text = html.slice(lastIndex, m.index);
      if (text) tokens.push({ type: 'text', text: decodeHtmlEntities(text) });
    }
    const full = m[0];
    const tag = m[1].toLowerCase();
    const rest = m[2] || '';
    const isClose = full.startsWith('</');
    const isSelfClose = full.endsWith('/>') || VOID_ELEMENTS.has(tag);
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(rest)) !== null) {
      const name = am[1].toLowerCase();
      const val = am[2] ?? am[3] ?? am[4] ?? '';
      attrs[name] = decodeHtmlEntities(val);
    }
    if (isClose) tokens.push({ type: 'close', tag });
    else if (isSelfClose) tokens.push({ type: 'void', tag, attrs });
    else tokens.push({ type: 'open', tag, attrs });
    lastIndex = m.index + full.length;
  }
  if (lastIndex < html.length) {
    const text = html.slice(lastIndex);
    if (text) tokens.push({ type: 'text', text: decodeHtmlEntities(text) });
  }
  return tokens;
}

const VOID_ELEMENTS = new Set(['br','hr','img','meta','link','input']);

/**
 * Parse alignment from either a CSS `text-align:` style or the legacy
 * HTML `align=""` attribute. Returns the docx `w:jc` value or null.
 */
function parseAlignment(attrs: Record<string, string> | undefined): 'left' | 'center' | 'right' | 'both' | null {
  if (!attrs) return null;
  const style = (attrs.style || '').toLowerCase();
  const m = style.match(/text-align\s*:\s*([a-z]+)/);
  const v = m ? m[1] : (attrs.align || '').toLowerCase();
  if (v === 'center') return 'center';
  if (v === 'right') return 'right';
  if (v === 'justify') return 'both';
  if (v === 'left') return 'left';
  return null;
}

/**
 * Sniff a page-break signal — we render either a literal `<div
 * class="page-break">` (what the editor inserts), a standards-y
 * `<div style="page-break-before:always">`, or an explicit
 * `<hr class="page-break">`. Returns true if the element should
 * emit a Word page-break character.
 */
function isPageBreakAttrs(attrs: Record<string, string> | undefined): boolean {
  if (!attrs) return false;
  const cls = (attrs.class || '').toLowerCase();
  const style = (attrs.style || '').toLowerCase();
  return cls.includes('page-break')
    || /page-break-(before|after)\s*:\s*always/.test(style);
}

// ─── Inline run state ──────────────────────────────────────────────────────
interface InlineState { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; hyperlink?: string | null; }

function runXml(state: InlineState, text: string): string {
  if (!text) return '';
  const rpr: string[] = [];
  if (state.bold) rpr.push('<w:b/>');
  if (state.italic) rpr.push('<w:i/>');
  if (state.underline) rpr.push('<w:u w:val="single"/>');
  if (state.strike) rpr.push('<w:strike/>');
  const rprXml = rpr.length > 0 ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  const t = `<w:t${preserve}>${xmlEscape(text)}</w:t>`;
  // Split on newlines so `\n` inside editor output produces line
  // breaks within the paragraph, not a lost character.
  const segments = text.split('\n');
  if (segments.length === 1) return `<w:r>${rprXml}${t}</w:r>`;
  const chunks = segments.map((seg, i) => {
    const tt = `<w:t xml:space="preserve">${xmlEscape(seg)}</w:t>`;
    const br = i < segments.length - 1 ? '<w:br/>' : '';
    return `<w:r>${rprXml}${tt}${br}</w:r>`;
  });
  return chunks.join('');
}

// ─── Converter ─────────────────────────────────────────────────────────────
interface ListState { kind: 'ul' | 'ol'; level: number; }

/**
 * Parser is a simple stack walk. Block elements flush the current
 * paragraph; inline elements toggle state. Tables and lists emit
 * dedicated XML fragments.
 */
export function htmlToDocxBody(html: string): string {
  const tokens = tokenise(html || '');
  const out: string[] = [];
  const inline: InlineState = {};
  let paragraphRuns: string[] = [];
  let paragraphPending = false; // true when we're inside an open <p>
  // The paragraph style / justification we'll emit on the NEXT flush
  // — set when we open a <h1>/<h2>/<h3> or a <p align="center"> etc.
  let pendingParaStyle: string | null = null;
  let pendingParaJc: 'left' | 'center' | 'right' | 'both' | null = null;
  const listStack: ListState[] = [];
  // Table state — only one level of table is supported in v1.
  let tableRows: string[] | null = null;
  let currentRowCells: string[] | null = null;
  let currentCellRuns: string[] | null = null;
  let inTableHeader = false;

  function flushParagraph(extraPpr?: string) {
    // Compose <w:pPr> from both the caller-supplied fragment (list
    // styles, etc.) and the pending-style state (heading, alignment).
    // Order inside <w:pPr> matters: pStyle must come first, jc later.
    const pprParts: string[] = [];
    if (pendingParaStyle) pprParts.push(`<w:pStyle w:val="${pendingParaStyle}"/>`);
    if (extraPpr) pprParts.push(extraPpr);
    if (pendingParaJc) pprParts.push(`<w:jc w:val="${pendingParaJc}"/>`);
    const ppr = pprParts.length > 0 ? `<w:pPr>${pprParts.join('')}</w:pPr>` : '';

    if (paragraphRuns.length === 0) {
      if (paragraphPending || pprParts.length > 0) out.push(`<w:p>${ppr}</w:p>`);
    } else if (!paragraphHasTextContent(paragraphRuns)) {
      // The paragraph contains only line-break runs (from `<p><br></p>`
      // spacer markup in the source HTML). Emit a single empty
      // paragraph instead — Word's default paragraph-after spacing is
      // already ~1 blank line, so keeping the inner <w:br/> would
      // render as TWO blank lines and stretch the document out.
      out.push(`<w:p>${ppr}</w:p>`);
    } else {
      out.push(`<w:p>${ppr}${paragraphRuns.join('')}</w:p>`);
    }
    paragraphRuns = [];
    paragraphPending = false;
    pendingParaStyle = null;
    pendingParaJc = null;
  }

  function appendText(text: string) {
    if (!text) return;
    if (currentCellRuns) {
      currentCellRuns.push(runXml(inline, text));
    } else {
      paragraphPending = true;
      paragraphRuns.push(runXml(inline, text));
    }
  }

  /**
   * Does a paragraph's accumulated run list contain any real, visible
   * text?  Returns false for:
   *   - runs with only <w:br/>  (from `<p><br></p>` spacers)
   *   - runs with <w:t> but only whitespace inside (from `<p>&nbsp;</p>`)
   *   - runs with no text elements at all
   *
   * Used by flushParagraph to avoid emitting paragraphs that render
   * as extra blank lines alongside Word's default paragraph spacing.
   */
  function paragraphHasTextContent(runs: string[]): boolean {
    for (const run of runs) {
      const matches = run.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      if (!matches) continue;
      for (const m of matches) {
        // Extract the text inside <w:t>…</w:t>.
        const text = m.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '');
        // Treat &nbsp; (xA0), regular whitespace, etc. as empty —
        // admins using contentEditable routinely hit <space> inside a
        // "blank" paragraph without realising.
        if (text.replace(/[\s\u00A0]/g, '').length > 0) return true;
      }
    }
    return false;
  }

  for (const tok of tokens) {
    if (tok.type === 'text') {
      const txt = tok.text ?? '';
      // Skip whitespace-only text that sits between block elements.
      if (!txt.trim() && !paragraphPending && !currentCellRuns && listStack.length === 0) continue;
      appendText(txt);
      continue;
    }
    const tag = tok.tag!;
    if (tok.type === 'open') {
      switch (tag) {
        case 'p':
        case 'div': {
          // If this div is a page-break marker, emit a break character
          // in a fresh paragraph rather than treating it as a normal
          // block container.
          if (isPageBreakAttrs(tok.attrs)) {
            flushParagraph();
            out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
            break;
          }
          if (paragraphPending || paragraphRuns.length) flushParagraph();
          paragraphPending = true;
          const jc = parseAlignment(tok.attrs);
          if (jc) pendingParaJc = jc;
          break;
        }
        // Heading paragraphs — map to Word's built-in Heading N styles.
        // Word ships Heading 1..9 in every default template, so these
        // render correctly against any firm skeleton out of the box.
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          if (paragraphPending || paragraphRuns.length) flushParagraph();
          paragraphPending = true;
          const level = Number(tag[1]);
          pendingParaStyle = `Heading${level}`;
          const jc = parseAlignment(tok.attrs);
          if (jc) pendingParaJc = jc;
          break;
        }
        case 'strong': case 'b': inline.bold = true; break;
        case 'em': case 'i': inline.italic = true; break;
        case 'u': inline.underline = true; break;
        case 's': case 'strike': case 'del': inline.strike = true; break;
        case 'a': inline.hyperlink = tok.attrs?.href || null; break;
        case 'ul': listStack.push({ kind: 'ul', level: listStack.length }); break;
        case 'ol': listStack.push({ kind: 'ol', level: listStack.length }); break;
        case 'li': {
          // Each list item is its own paragraph with a list-style ppr.
          flushParagraph();
          paragraphPending = true;
          break;
        }
        case 'table':
          flushParagraph();
          tableRows = [];
          break;
        case 'tr':
          if (tableRows) currentRowCells = [];
          break;
        case 'th':
        case 'td':
          if (currentRowCells) {
            currentCellRuns = [];
            inTableHeader = tag === 'th';
          }
          break;
        // <span> is a transparent inline wrapper — the editor uses it
        // to render merge-field pills. We don't need special handling
        // since the children carry the text; just let it pass.
        case 'span':
          break;
        default: /* unknown open tag — ignore */ break;
      }
    } else if (tok.type === 'close') {
      switch (tag) {
        case 'p':
        case 'div': flushParagraph(); break;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          flushParagraph();
          break;
        case 'strong': case 'b': inline.bold = false; break;
        case 'em': case 'i': inline.italic = false; break;
        case 'u': inline.underline = false; break;
        case 's': case 'strike': case 'del': inline.strike = false; break;
        case 'a': inline.hyperlink = null; break;
        case 'ul': case 'ol': listStack.pop(); break;
        case 'span': break;
        case 'li': {
          const list = listStack[listStack.length - 1];
          // Minimal list rendering: use `ListBullet` / `ListNumber`
          // built-in paragraph styles. Most Word defaults ship both.
          const styleId = list?.kind === 'ol' ? 'ListNumber' : 'ListBullet';
          flushParagraph(`<w:pStyle w:val="${styleId}"/>`);
          break;
        }
        case 'table': {
          if (tableRows) {
            // A modest default: full-width auto, single 4-point border.
            const border = `<w:tblBorders>
              <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
              <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
              <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
              <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
              <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
              <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
            </w:tblBorders>`;
            const tblPr = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/>${border}</w:tblPr>`;
            out.push(`<w:tbl>${tblPr}${tableRows.join('')}</w:tbl>`);
          }
          tableRows = null;
          break;
        }
        case 'tr':
          if (tableRows && currentRowCells) tableRows.push(`<w:tr>${currentRowCells.join('')}</w:tr>`);
          currentRowCells = null;
          break;
        case 'th':
        case 'td':
          if (currentRowCells && currentCellRuns) {
            const cellPara = currentCellRuns.length > 0
              ? `<w:p>${inTableHeader ? '<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>' : ''}${currentCellRuns.join('')}</w:p>`
              : '<w:p/>';
            currentRowCells.push(`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${cellPara}</w:tc>`);
          }
          currentCellRuns = null;
          inTableHeader = false;
          break;
        default: break;
      }
    } else if (tok.type === 'void') {
      if (tag === 'br') {
        if (currentCellRuns) currentCellRuns.push('<w:r><w:br/></w:r>');
        else { paragraphPending = true; paragraphRuns.push('<w:r><w:br/></w:r>'); }
      } else if (tag === 'hr') {
        // Horizontal rule — render as a paragraph with a thin bottom
        // border. Flush any open paragraph first so it doesn't pick up
        // the border too.
        flushParagraph();
        out.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`);
      } else if (tag === 'img') {
        // v1 images: rendered as a placeholder text. Proper image
        // embedding requires relationship plumbing we haven't wired.
        const alt = tok.attrs?.alt || '[image]';
        paragraphPending = true;
        paragraphRuns.push(runXml(inline, alt));
      }
      // Explicit void page-break marker e.g. `<div class="page-break"/>`
      // is already handled in the 'open' case above because Word editors
      // usually emit it as an open div rather than a self-closing tag.
    }
  }
  // Flush any trailing paragraph.
  flushParagraph();

  // Guarantee at least one body element — an entirely empty fragment
  // would leave `{@body}` unreplaced in some docxtemplater versions.
  if (out.length === 0) out.push('<w:p/>');

  // ── Post-processing passes ────────────────────────────────────────
  // Apply against the joined XML string rather than the element array
  // so patterns that span multiple emitted fragments (e.g. a row we
  // may drop consists of multiple `<w:tc>`s) can be matched in one go.
  let xml = out.join('');

  // 1. Normalise every "effectively empty" paragraph to a single
  //    canonical `<w:p/>`, then collapse consecutive canonical empties
  //    down to 1. "Effectively empty" covers:
  //      <w:p/>                                  self-closing
  //      <w:p></w:p>                             open/close, nothing inside
  //      <w:p><w:pPr>…</w:pPr></w:p>             pPr only, no runs
  //      <w:p>…runs with only <w:br/>…</w:p>     line-break-only runs
  //      <w:p>…runs with only whitespace <w:t>…</w:p>
  //                                              from <p>&nbsp;</p> etc.
  //    Word's default paragraph-after spacing already provides one
  //    blank line between paragraphs, so a single `<w:p/>` is all
  //    we need to separate sections. Anything more than that is
  //    almost always contentEditable enthusiasm producing stacks of
  //    spacer paragraphs — we strip them out.
  const normaliseEmptyParagraph = (full: string): string => {
    // Extract the inner content between the paragraph's open and close tags.
    const opened = full.match(/^<w:p(?:\s[^>]*)?>/);
    if (!opened) return full; // self-closing — already canonical enough
    const inner = full.slice(opened[0].length, full.length - '</w:p>'.length);
    // Drop <w:pPr>…</w:pPr> — that's paragraph formatting, not content.
    const withoutPpr = inner.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, '');
    // Any <w:t> with non-whitespace text? Keep the paragraph as-is.
    const textMatches = withoutPpr.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    for (const tm of textMatches) {
      const text = tm.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '');
      if (text.replace(/[\s\u00A0]/g, '').length > 0) return full;
    }
    return '<w:p/>';
  };
  // Canonicalise self-closing + attribute-bearing self-closing first.
  xml = xml.replace(/<w:p(?:\s[^>]*)?\s*\/>/g, '<w:p/>');
  // Then walk paired <w:p>…</w:p> paragraphs and normalise the empties.
  xml = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, normaliseEmptyParagraph);
  // Drop canonical empty paragraphs entirely. Word applies
  // paragraph-after spacing to EVERY paragraph (typically ~8pt in the
  // Normal style), so keeping even a single `<w:p/>` between two
  // text paragraphs renders as TWO visible blank lines: one for the
  // after-spacing above the empty, one for the empty paragraph
  // itself. Removing the empties leaves Word's default paragraph
  // spacing to produce exactly one visual blank line between blocks,
  // matching the preview. Intentional large gaps can be added back
  // later via explicit <w:spacing> in a future pass if needed.
  xml = xml.replace(/<w:p\/>/g, '');
  // Safety net — if every paragraph got stripped (rare, but possible
  // on an entirely blank body) inject a single empty paragraph so
  // docxtemplater has something to substitute.
  if (!/<w:p\b/.test(xml)) xml = '<w:p/>';

  // 2. Drop table rows where every cell is empty. This catches the
  //    common "Handlebars {{#each}} block produced no iterations but
  //    the admin left a static empty placeholder row in the table"
  //    failure mode — the output otherwise ships with a ghost row
  //    that reviewers have to delete by hand.
  xml = xml.replace(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g, (full, inner: string) => {
    // Every `<w:tc>` in this row — does ANY of them contain a run
    // with a `<w:t>` (real text)?  If not, drop the row.
    const cells = inner.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) || [];
    if (cells.length === 0) return full; // malformed — leave alone
    const hasAnyText = cells.some(cell => /<w:t[ >]/.test(cell));
    return hasAnyText ? full : '';
  });

  return xml;
}
