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

// ─── CSS style parsing ─────────────────────────────────────────────────────
/** Parse a `style="color:#123; font-size:14pt; font-weight:bold"` blob
 *  into a map of lowercase property → lowercase value. Trims both sides
 *  and strips the optional trailing semicolon. Silent on malformed
 *  declarations — they just get dropped. */
function parseStyle(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const decl of String(raw).split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (prop && val) out[prop] = val;
  }
  return out;
}

/** Normalise CSS colour values to an OOXML hex-6. Accepts #abc /
 *  #aabbcc / rgb(r,g,b) / named colours we can resolve. Returns
 *  null when the input isn't something we can safely emit. */
const NAMED_COLOURS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000',
  blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080',
  silver: 'C0C0C0', maroon: '800000', olive: '808000', lime: '00FF00',
  aqua: '00FFFF', teal: '008080', navy: '000080', fuchsia: 'FF00FF',
  purple: '800080',
};
function parseColour(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'inherit' || s === 'initial') return null;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-f]{6}$/.test(hex)) return hex.toUpperCase();
    if (/^[0-9a-f]{3}$/.test(hex)) return (hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]).toUpperCase();
  }
  const rgbMatch = s.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    const toHex = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0').toUpperCase();
    return `${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  if (NAMED_COLOURS[s]) return NAMED_COLOURS[s];
  return null;
}

/** Parse `font-size: 14pt` / `font-size: 14px` / `font-size: 1.2em` into
 *  Word's half-point unit used by `<w:sz w:val="...">`. Returns null for
 *  unrecognised inputs. 12pt = 24 half-points. */
function parseFontSizeHalfPoints(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  const m = s.match(/^(-?\d+(?:\.\d+)?)(pt|px|em|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] || 'pt';
  let pt: number;
  if (unit === 'pt') pt = n;
  else if (unit === 'px') pt = n * 0.75;           // 96px = 72pt
  else if (unit === 'em' || unit === 'rem') pt = n * 11; // assume 11pt base
  else return null;
  return Math.max(2, Math.round(pt * 2)); // half-points, floor 1pt
}

/** Parse `border: 1px solid #ccc` / `border: 2pt dotted black` into a
 *  Word border descriptor. We only use the size + colour + style. Returns
 *  null if nothing meaningful can be extracted. Border sizes in Word are
 *  measured in eighths of a point; 1px ≈ 0.75pt ≈ 6 eighths. */
function parseBorderShorthand(raw: string | null | undefined): { size: number; color: string; style: string } | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'none' || s === '0') return null;
  const sizeMatch = s.match(/(\d+(?:\.\d+)?)\s*(px|pt)?/);
  const colourHex = parseColour(s.match(/#[0-9a-f]{3,6}|rgb\([^)]+\)|[a-z]+/g)?.find(t => parseColour(t) !== null) || null) || 'auto';
  let size = 4; // default 0.5pt in eighths = 4
  if (sizeMatch) {
    const n = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2] || 'px';
    const pt = unit === 'pt' ? n : n * 0.75;
    size = Math.max(2, Math.min(96, Math.round(pt * 8)));
  }
  let style = 'single';
  if (/dashed/.test(s)) style = 'dashed';
  else if (/dotted/.test(s)) style = 'dotted';
  else if (/double/.test(s)) style = 'double';
  return { size, color: colourHex, style };
}

/** Force a run to render bold — used for `<th>` cells when the template
 *  author didn't explicitly style them. If the run already has an <w:rPr>
 *  we splice <w:b/> in; otherwise we insert a new <w:rPr>. */
function injectHeaderBold(run: string): string {
  if (/<w:rPr>/.test(run)) {
    return run.replace(/<w:rPr>/, '<w:rPr><w:b/><w:bCs/>');
  }
  return run.replace(/<w:r>/, '<w:r><w:rPr><w:b/><w:bCs/></w:rPr>');
}

// ─── Inline run state ──────────────────────────────────────────────────────
interface InlineState {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  hyperlink?: string | null;
  /** 6-hex colour without the leading #, e.g. "FF0000". */
  color?: string | null;
  /** 6-hex background / highlight colour for the text. */
  backgroundColor?: string | null;
  /** Half-points (Word's unit). 24 = 12pt body. */
  fontSizeHalfPt?: number | null;
  /** Font family name, verbatim. */
  fontFamily?: string | null;
  /** Stack of inline styling pushed by `<span style="…">` elements so a
   *  closing `</span>` reverts exactly what the opening span applied,
   *  rather than clobbering state that was already set by a parent. */
  spanStack?: Array<Partial<InlineState>>;
}

/** Apply a `style="…"` blob to the inline state, returning the previous
 *  values of every key touched so the caller can restore them on the
 *  matching close tag. */
function applyInlineStyles(state: InlineState, style: Record<string, string>): Partial<InlineState> {
  const before: Partial<InlineState> = {};
  if (style.color) {
    const c = parseColour(style.color);
    if (c) { before.color = state.color; state.color = c; }
  }
  if (style['background-color']) {
    const c = parseColour(style['background-color']);
    if (c) { before.backgroundColor = state.backgroundColor; state.backgroundColor = c; }
  }
  if (style['font-size']) {
    const sz = parseFontSizeHalfPoints(style['font-size']);
    if (sz) { before.fontSizeHalfPt = state.fontSizeHalfPt; state.fontSizeHalfPt = sz; }
  }
  if (style['font-family']) {
    const f = style['font-family'].replace(/^['"]|['"]$/g, '').split(',')[0]?.trim();
    if (f) { before.fontFamily = state.fontFamily; state.fontFamily = f; }
  }
  if (/(^|\s)bold(\s|$)|^[6-9]00$/.test(style['font-weight'] || '')) {
    before.bold = state.bold; state.bold = true;
  }
  if (style['font-style'] === 'italic' || style['font-style'] === 'oblique') {
    before.italic = state.italic; state.italic = true;
  }
  if ((style['text-decoration'] || '').includes('underline')) {
    before.underline = state.underline; state.underline = true;
  }
  if ((style['text-decoration'] || '').includes('line-through')) {
    before.strike = state.strike; state.strike = true;
  }
  return before;
}

function runXml(state: InlineState, text: string): string {
  if (!text) return '';
  const rpr: string[] = [];
  // Font family first — Word expects rFonts before other run formatting.
  if (state.fontFamily) rpr.push(`<w:rFonts w:ascii="${xmlEscape(state.fontFamily)}" w:hAnsi="${xmlEscape(state.fontFamily)}" w:cs="${xmlEscape(state.fontFamily)}"/>`);
  if (state.bold) rpr.push('<w:b/><w:bCs/>');
  if (state.italic) rpr.push('<w:i/><w:iCs/>');
  if (state.strike) rpr.push('<w:strike/>');
  if (state.color) rpr.push(`<w:color w:val="${state.color}"/>`);
  if (state.fontSizeHalfPt) rpr.push(`<w:sz w:val="${state.fontSizeHalfPt}"/><w:szCs w:val="${state.fontSizeHalfPt}"/>`);
  if (state.backgroundColor) rpr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${state.backgroundColor}"/>`);
  if (state.underline) rpr.push('<w:u w:val="single"/>');
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
  let tableAttrs: Record<string, string> | null = null;
  let tableRows: string[] | null = null;
  let currentRowAttrs: Record<string, string> | null = null;
  let currentRowCells: string[] | null = null;
  let currentCellAttrs: Record<string, string> | null = null;
  let currentCellRuns: string[] | null = null;
  let inTableHeader = false;

  // Consistent paragraph spacing for every text paragraph we emit —
  // 12pt after, no before, 1.15 line spacing. This overrides whatever
  // the firm skeleton's Normal style has configured so the visual
  // output is predictable across every skeleton: one clean blank-
  // line-sized gap between paragraphs, exactly matching the preview.
  // `w:after` is in twentieths of a point (240 = 12pt).
  const PARAGRAPH_SPACING_PPR = '<w:spacing w:before="0" w:after="240" w:line="276" w:lineRule="auto"/>';

  function flushParagraph(extraPpr?: string) {
    // Compose <w:pPr> from both the caller-supplied fragment (list
    // styles, etc.) and the pending-style state (heading, alignment).
    // Order inside <w:pPr> matters: pStyle → spacing → jc (w:jc must
    // come after spacing per ECMA-376).
    const pprParts: string[] = [];
    if (pendingParaStyle) pprParts.push(`<w:pStyle w:val="${pendingParaStyle}"/>`);
    if (extraPpr) pprParts.push(extraPpr);
    // Only apply our spacing override to body paragraphs — headings
    // carry their own spacing from the skeleton's Heading styles,
    // which we leave alone so the firm's typography decisions stand.
    if (!pendingParaStyle) pprParts.push(PARAGRAPH_SPACING_PPR);
    if (pendingParaJc) pprParts.push(`<w:jc w:val="${pendingParaJc}"/>`);
    const ppr = pprParts.length > 0 ? `<w:pPr>${pprParts.join('')}</w:pPr>` : '';

    if (paragraphRuns.length === 0) {
      if (paragraphPending || pprParts.length > 0) out.push(`<w:p>${ppr}</w:p>`);
    } else if (!paragraphHasTextContent(paragraphRuns)) {
      // The paragraph contains only line-break runs (from `<p><br></p>`
      // spacer markup in the source HTML). Emit a single empty
      // paragraph — post-processing will strip it and rely on the
      // explicit after-spacing on the surrounding text paragraphs.
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
          // Paragraph-level inline styles (colour, font-size on the
          // <p> itself) apply to runs inside the paragraph. Push them
          // onto the span stack so every child run picks them up and
          // the closing </p> restores the surrounding state.
          const style = parseStyle(tok.attrs?.style);
          if (Object.keys(style).length > 0) {
            const before = applyInlineStyles(inline, style);
            (inline.spanStack ||= []).push({ ...before, _paraSpan: true } as any);
          } else {
            (inline.spanStack ||= []).push({ _paraSpan: true } as any);
          }
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
        case 'a': {
          inline.hyperlink = tok.attrs?.href || null;
          // Default to the typical hyperlink look so links are visible
          // in the output even without an explicit colour in the
          // source HTML.
          (inline.spanStack ||= []).push({ color: inline.color, underline: inline.underline });
          inline.color = '0563C1';
          inline.underline = true;
          break;
        }
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
          tableAttrs = tok.attrs || {};
          tableRows = [];
          break;
        case 'tr':
          if (tableRows) {
            currentRowAttrs = tok.attrs || {};
            currentRowCells = [];
          }
          break;
        case 'th':
        case 'td':
          if (currentRowCells) {
            currentCellAttrs = tok.attrs || {};
            currentCellRuns = [];
            inTableHeader = tag === 'th';
          }
          break;
        // <span style="…"> is the contentEditable editor's primary
        // vehicle for inline styling — colour, font size, bold from
        // the toolbar, etc. Parse the style, apply to the inline
        // state, and push what we changed onto a stack so the matching
        // </span> can restore it.
        case 'span': {
          const style = parseStyle(tok.attrs?.style);
          if (Object.keys(style).length === 0) {
            (inline.spanStack ||= []).push({});
            break;
          }
          const before = applyInlineStyles(inline, style);
          (inline.spanStack ||= []).push(before);
          break;
        }
        default: /* unknown open tag — ignore */ break;
      }
    } else if (tok.type === 'close') {
      switch (tag) {
        case 'p':
        case 'div': {
          flushParagraph();
          // Pop the paragraph-level span we pushed on open so
          // inline styles set on the <p>/<div> don't leak into
          // subsequent content.
          const before = (inline.spanStack || []).pop();
          if (before) {
            for (const key of Object.keys(before) as Array<keyof InlineState>) {
              if (key === ('_paraSpan' as any)) continue;
              (inline as any)[key] = (before as any)[key];
            }
          }
          break;
        }
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          flushParagraph();
          break;
        case 'strong': case 'b': inline.bold = false; break;
        case 'em': case 'i': inline.italic = false; break;
        case 'u': inline.underline = false; break;
        case 's': case 'strike': case 'del': inline.strike = false; break;
        case 'a': {
          inline.hyperlink = null;
          const before = (inline.spanStack || []).pop();
          if (before) {
            if ('color' in before) inline.color = before.color ?? null;
            if ('underline' in before) inline.underline = before.underline;
          }
          break;
        }
        case 'ul': case 'ol': listStack.pop(); break;
        case 'span': {
          // Pop the styling the matching <span open> pushed. Each
          // key that was changed is restored; keys that weren't
          // touched are left alone.
          const before = (inline.spanStack || []).pop();
          if (before) {
            for (const key of Object.keys(before) as Array<keyof InlineState>) {
              (inline as any)[key] = before[key];
            }
          }
          break;
        }
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
            // Borders — honour the table's inline `border-color` /
            // `border-width` / `border-style` when present, otherwise
            // fall back to a thin single-line border on all edges.
            const tStyle = parseStyle(tableAttrs?.style);
            const borderSpec = parseBorderShorthand(tStyle.border)
              || (tStyle['border-color'] || tStyle['border-width']
                  ? parseBorderShorthand(`${tStyle['border-width'] || '1px'} solid ${tStyle['border-color'] || '#000'}`)
                  : null)
              || { size: 4, color: 'auto', style: 'single' };
            const b = (pos: string) => `<w:${pos} w:val="${borderSpec.style}" w:sz="${borderSpec.size}" w:space="0" w:color="${borderSpec.color}"/>`;
            const border = `<w:tblBorders>${b('top')}${b('left')}${b('bottom')}${b('right')}${b('insideH')}${b('insideV')}</w:tblBorders>`;
            // Width — honour `width:Xpx` inline, default to 100%.
            let tblW = '<w:tblW w:w="5000" w:type="pct"/>';
            const widthStyle = tStyle.width;
            if (widthStyle) {
              const pct = widthStyle.match(/(\d+)\s*%/);
              if (pct) tblW = `<w:tblW w:w="${parseInt(pct[1], 10) * 50}" w:type="pct"/>`;
            }
            const tblPr = `<w:tblPr>${tblW}${border}</w:tblPr>`;
            out.push(`<w:tbl>${tblPr}${tableRows.join('')}</w:tbl>`);
          }
          tableAttrs = null;
          tableRows = null;
          break;
        }
        case 'tr':
          if (tableRows && currentRowCells) tableRows.push(`<w:tr>${currentRowCells.join('')}</w:tr>`);
          currentRowAttrs = null;
          currentRowCells = null;
          break;
        case 'th':
        case 'td':
          if (currentRowCells && currentCellRuns) {
            // Cell styling — resolve bg colour from cell, row, or
            // header-is-a-th fallback (light grey). Resolve width from
            // `width:Npx` / `Npt` / `N%` on the cell.
            const cellStyle = parseStyle(currentCellAttrs?.style);
            const rowStyle = parseStyle(currentRowAttrs?.style);
            const bg = parseColour(cellStyle['background-color']) || parseColour(rowStyle['background-color']);
            const shd = bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : '';
            // Width — twips (1pt = 20 twips; 1px ≈ 15 twips).
            let tcW = '<w:tcW w:w="0" w:type="auto"/>';
            const w = cellStyle.width;
            if (w) {
              const pxMatch = w.match(/(\d+)\s*px/);
              const ptMatch = w.match(/(\d+)\s*pt/);
              const pctMatch = w.match(/(\d+)\s*%/);
              if (pxMatch) tcW = `<w:tcW w:w="${parseInt(pxMatch[1], 10) * 15}" w:type="dxa"/>`;
              else if (ptMatch) tcW = `<w:tcW w:w="${parseInt(ptMatch[1], 10) * 20}" w:type="dxa"/>`;
              else if (pctMatch) tcW = `<w:tcW w:w="${parseInt(pctMatch[1], 10) * 50}" w:type="pct"/>`;
            }
            const tcPr = `<w:tcPr>${tcW}${shd}</w:tcPr>`;
            // Paragraph inside the cell. Headers get bold via the rPr
            // on every run; we also centre header text so the default
            // table header pattern reads cleanly.
            let cellPara: string;
            if (currentCellRuns.length > 0) {
              const pPr = inTableHeader
                ? '<w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="center"/></w:pPr>'
                : '<w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>';
              const runs = inTableHeader
                ? currentCellRuns.map(r => injectHeaderBold(r)).join('')
                : currentCellRuns.join('');
              cellPara = `<w:p>${pPr}${runs}</w:p>`;
            } else {
              cellPara = '<w:p/>';
            }
            currentRowCells.push(`<w:tc>${tcPr}${cellPara}</w:tc>`);
          }
          currentCellAttrs = null;
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
