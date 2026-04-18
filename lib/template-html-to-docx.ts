/**
 * Minimal HTML → OOXML (docx body-fragment) converter.
 *
 * The output is a string of `<w:p>` / `<w:tbl>` elements that slots
 * straight into a .docx file via docxtemplater's raw-XML (`{@body}`)
 * tag. The firm skeleton retains its header / footer / page setup;
 * this fragment becomes the body flow.
 *
 * Scope: handles the subset of HTML the contentEditable editor in
 * `TemplateDocumentsClient` actually produces:
 *   <p>, <br>, <strong>/<b>, <em>/<i>, <u>, <s>
 *   <ul>/<ol>/<li>, <a href>, <table>/<tr>/<td>/<th>
 *   text nodes (with entity decoding and XML escaping)
 *
 * Everything else is rendered as plain text inside a paragraph —
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
  const listStack: ListState[] = [];
  // Table state — only one level of table is supported in v1.
  let tableRows: string[] | null = null;
  let currentRowCells: string[] | null = null;
  let currentCellRuns: string[] | null = null;
  let inTableHeader = false;

  function flushParagraph(extraPpr?: string) {
    if (paragraphRuns.length === 0) {
      if (paragraphPending) out.push(`<w:p/>`); // empty paragraph
    } else {
      const ppr = extraPpr ? `<w:pPr>${extraPpr}</w:pPr>` : '';
      out.push(`<w:p>${ppr}${paragraphRuns.join('')}</w:p>`);
    }
    paragraphRuns = [];
    paragraphPending = false;
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
        case 'div':
          if (paragraphPending || paragraphRuns.length) flushParagraph();
          paragraphPending = true;
          break;
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
        default: /* unknown open tag — ignore */ break;
      }
    } else if (tok.type === 'close') {
      switch (tag) {
        case 'p':
        case 'div': flushParagraph(); break;
        case 'strong': case 'b': inline.bold = false; break;
        case 'em': case 'i': inline.italic = false; break;
        case 'u': inline.underline = false; break;
        case 's': case 'strike': case 'del': inline.strike = false; break;
        case 'a': inline.hyperlink = null; break;
        case 'ul': case 'ol': listStack.pop(); break;
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
      }
    }
  }
  // Flush any trailing paragraph.
  flushParagraph();

  // Guarantee at least one body element — an entirely empty fragment
  // would leave `{@body}` unreplaced in some docxtemplater versions.
  if (out.length === 0) out.push('<w:p/>');
  return out.join('');
}
