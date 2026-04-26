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
 *
 * A final validation pass (see `docx-xml-validator.ts`) runs after all
 * auto-repair to catch any remaining OOXML schema defects before the
 * XML ships to Word. Any defect at that point indicates a new pattern
 * of input HTML producing bad output — log it, investigate, teach the
 * repairer. This is how we avoid regressing on "unreadable content"
 * dialogs after every edit to this file.
 */

import { validateAndLogDocxBodyXml } from './docx-xml-validator';

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
/**
 * Resolve a CSS background colour from a parsed-style map, accepting
 * BOTH the long form `background-color: #xxx` and the shorthand
 * `background: #xxx` (which is what hand-written HTML in our editor
 * tends to emit). The shorthand can also carry image / position /
 * repeat tokens (`background: url(...) center no-repeat #fff`); we
 * extract the first thing parseColour can recognise as a colour.
 *
 * Used by both the inline-run state machine (text highlight) and the
 * table cell <w:shd> emitter (cell fill).
 */
function resolveBackgroundColour(style: Record<string, string>): string | null {
  if (!style) return null;
  const direct = parseColour(style['background-color']);
  if (direct) return direct;
  const shorthand = style['background'];
  if (!shorthand) return null;
  // Try the whole value first — covers the common case of just
  // `background: #fff` or `background: red`.
  const whole = parseColour(shorthand);
  if (whole) return whole;
  // Fallback: scan tokens. A `background` shorthand with an image
  // and a colour together (`background: url(x.png) #fff`) won't
  // parse as a single colour but each space-separated token will,
  // and the colour token is the one we want.
  for (const tok of shorthand.split(/\s+/)) {
    const c = parseColour(tok);
    if (c) return c;
  }
  return null;
}

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

/** A near-black colour is indistinguishable from the skeleton's default
 *  text colour for the reader, but stamping it explicitly on every run
 *  OVERRIDES the skeleton's own styling (e.g. blue heading text). We
 *  strip such colours so the skeleton's Normal / Heading styles take
 *  effect. Threshold chosen to cover Tailwind's slate-950 (#020817)
 *  and similar "just about black" colours the contentEditable editor
 *  emits by default, without accidentally catching intentional dark
 *  blues / greens. */
function isEffectivelyDefaultTextColour(hex: string | null | undefined): boolean {
  if (!hex || hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Anything with every channel ≤ 0x24 (36) is visually black/very
  // dark grey — safe to drop. Tailwind slate-950 = (2,8,23); slate-900
  // = (15,23,42) — we want to catch both.
  return r <= 0x24 && g <= 0x24 && b <= 0x30;
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
  // Inline highlight — accept either `background-color: #xxx` (long
  // form) or `background: #xxx` (shorthand). The shorthand is what
  // hand-written HTML in our template editor tends to emit, e.g.
  // `<th style="background:#f1f9f8">`.
  if (style['background-color'] || style['background']) {
    const c = resolveBackgroundColour(style);
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
  // Child order inside <w:rPr> is defined by ECMA-376 and is strict —
  // Word's "recover contents" repair dialog will fire if the order is
  // wrong. The sequence is (subset we use):
  //   rFonts → b/bCs → i/iCs → strike → color → sz/szCs → u → shd
  if (state.fontFamily) rpr.push(`<w:rFonts w:ascii="${xmlEscape(state.fontFamily)}" w:hAnsi="${xmlEscape(state.fontFamily)}" w:cs="${xmlEscape(state.fontFamily)}"/>`);
  if (state.bold) rpr.push('<w:b/><w:bCs/>');
  if (state.italic) rpr.push('<w:i/><w:iCs/>');
  if (state.strike) rpr.push('<w:strike/>');
  // Skip near-black colours — they're what the contentEditable editor
  // emits as its default text colour (Tailwind slate-950 etc.). Leave
  // the Normal style to own "dark text".
  if (state.color && !isEffectivelyDefaultTextColour(state.color)) rpr.push(`<w:color w:val="${state.color}"/>`);
  if (state.fontSizeHalfPt) rpr.push(`<w:sz w:val="${state.fontSizeHalfPt}"/><w:szCs w:val="${state.fontSizeHalfPt}"/>`);
  if (state.underline) rpr.push('<w:u w:val="single"/>');
  if (state.backgroundColor) rpr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${state.backgroundColor}"/>`);
  const rprXml = rpr.length > 0 ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  // Single-segment case (no embedded newlines) — always has text.
  const segments = text.split('\n');
  if (segments.length === 1) {
    return `<w:r>${rprXml}<w:t${preserve}>${xmlEscape(text)}</w:t></w:r>`;
  }
  // Multi-segment case (newlines embed line breaks in-paragraph).
  // Critical: never emit <w:t></w:t> — empty text elements make
  // Word flag the file as unreadable content. Runs that would have
  // only a break and no text collapse to <w:r><w:br/></w:r>;
  // trailing empty segments are dropped entirely.
  const chunks: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const needsBr = i < segments.length - 1;
    const hasText = seg.length > 0;
    if (!hasText && !needsBr) continue;
    const segPreserve = /^\s|\s$/.test(seg) ? ' xml:space="preserve"' : '';
    const tt = hasText ? `<w:t${segPreserve}>${xmlEscape(seg)}</w:t>` : '';
    const br = needsBr ? '<w:br/>' : '';
    chunks.push(`<w:r>${rprXml}${tt}${br}</w:r>`);
  }
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
    // Only apply our spacing override to unstyled body paragraphs.
    // Headings carry their own typography from the skeleton's Heading
    // N styles; list items from ListBullet / ListNumber. Stamping our
    // 12pt-after spacing on top of those would flatten the intended
    // hierarchy.
    const hasExplicitStyle = !!pendingParaStyle || (extraPpr || '').includes('w:pStyle');
    if (!hasExplicitStyle) pprParts.push(PARAGRAPH_SPACING_PPR);
    if (pendingParaJc) pprParts.push(`<w:jc w:val="${pendingParaJc}"/>`);
    const ppr = pprParts.length > 0 ? `<w:pPr>${pprParts.join('')}</w:pPr>` : '';

    // Strip leading / trailing break-only and whitespace-only runs.
    // The contentEditable editor routinely emits <p>&nbsp;<br>text</p>
    // when the admin presses Enter at the top of a line — shipping
    // those as-is adds blank lines at the top / bottom of every
    // paragraph, one of the big visual issues in the Kanova letter.
    const trimmed = trimEdgeBreakRuns(paragraphRuns);

    if (trimmed.length === 0) {
      if (paragraphPending || pprParts.length > 0) out.push(`<w:p>${ppr}</w:p>`);
    } else if (!paragraphHasTextContent(trimmed)) {
      out.push(`<w:p>${ppr}</w:p>`);
    } else {
      out.push(`<w:p>${ppr}${trimmed.join('')}</w:p>`);
    }
    paragraphRuns = [];
    paragraphPending = false;
    pendingParaStyle = null;
    pendingParaJc = null;
  }

  /** Trim runs at the start and end of a paragraph that are either
   *  pure <w:br/> carriers or contain only whitespace text. Leaves the
   *  middle of the paragraph untouched so an intentional line break
   *  between words (from a standalone <br> in the source) survives. */
  function trimEdgeBreakRuns(runs: string[]): string[] {
    const isEdgeDroppable = (run: string): boolean => {
      // <w:br/> present AND no text with real content → droppable.
      if (!/<w:t[ >]/.test(run)) return /<w:br/.test(run);
      // Text present — droppable only if ALL text is whitespace.
      const texts = run.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      return texts.every(t => {
        const inner = t.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '');
        return inner.replace(/[\s\u00A0]/g, '').length === 0;
      });
    };
    let start = 0;
    while (start < runs.length && isEdgeDroppable(runs[start])) start++;
    let end = runs.length;
    while (end > start && isEdgeDroppable(runs[end - 1])) end--;
    return runs.slice(start, end);
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
          if (tableRows && tableRows.length > 0) {
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
            // <w:tblLook> describes which parts of the table style to
            // apply. Word auto-adds it if missing, but the auto-add
            // triggers the "We found a problem with some of the
            // content" repair dialog. Emit a minimal tblLook so Word
            // opens the document cleanly without recovery.
            // firstRow/firstColumn = 1 applies header styling to the
            // top row / leftmost column; noHBand/noVBand disable the
            // table's own banded-row formatting (we don't emit any).
            const tblLook = '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';
            const tblPr = `<w:tblPr>${tblW}${border}${tblLook}</w:tblPr>`;

            // <w:tblGrid> is REQUIRED per OOXML schema — every table
            // MUST declare its column widths, otherwise Word flags
            // the file as unreadable content and offers to repair.
            // Count cells in the first row to pick the column count;
            // distribute the total table width evenly across columns.
            const firstRow = tableRows[0] || '';
            const cellCount = (firstRow.match(/<w:tc\b/g) || []).length || 1;
            // 9638 twips ≈ A4 portrait content width (pre-margin). Word
            // treats these as hints when tblW is 'auto' / 'pct'.
            const colWidth = Math.floor(9638 / cellCount);
            const gridCols = Array.from({ length: cellCount }).map(() => `<w:gridCol w:w="${colWidth}"/>`).join('');
            const tblGrid = `<w:tblGrid>${gridCols}</w:tblGrid>`;

            out.push(`<w:tbl>${tblPr}${tblGrid}${tableRows.join('')}</w:tbl>`);
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
            // Cell shading — accept either `background-color: #xxx`
            // (long form) or `background: #xxx` (shorthand) on the cell
            // OR the row. Hand-written HTML in our editor tends to use
            // the shorthand (`<th style="background:#f1f9f8">`).
            const bg = resolveBackgroundColour(cellStyle) || resolveBackgroundColour(rowStyle);
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
  // Defensive: strip any empty <w:t>…</w:t> or empty <w:r>…</w:r>
  // elements before they reach Word. Empty <w:t> is technically
  // valid per OOXML XSD but Word's strict parser pops the "We found
  // a problem with some of the content" repair dialog when it sees
  // them. runXml is now careful not to produce these, but other
  // code paths (and any future additions) could still slip through,
  // so we sweep once more here.
  xml = xml.replace(/<w:t\b[^>]*>\s*<\/w:t>/g, '');
  xml = xml.replace(/<w:r>\s*<\/w:r>/g, '');
  // Also drop runs that contain ONLY an rPr (styling with no text
  // or break) — they render nothing visible but can confuse strict
  // validators by appearing to be "styled empty content".
  // CRITICAL: tempered non-greedy. The naive `[\s\S]*?` form that
  // used to be here would catastrophically overmatch — when the
  // engine started at a NON-empty run like
  //   <w:r><w:rPr>…</w:rPr><w:t>Some Text</w:t></w:r>
  // the first `</w:rPr>` was followed by `<w:t>` not `</w:r>`, so
  // the engine extended `[\s\S]*?` searching for a LATER
  // `</w:rPr></w:r>` pair, eventually finding one in a different,
  // truly-empty run thousands of bytes later — and replacing
  // EVERYTHING in between with `''`. Whole tables silently
  // disappeared from the rendered .docx.
  //
  // The tempered form `(?:(?!<\/?w:r\b)[\s\S])*?` matches any
  // character except positions where another `<w:r>` open or
  // `</w:r>` close would start, keeping the match strictly within a
  // single run. Empty-rPr-only runs still get stripped; non-empty
  // runs are now untouchable by this pass.
  xml = xml.replace(/<w:r>\s*<w:rPr>(?:(?!<\/?w:r\b)[\s\S])*?<\/w:rPr>\s*<\/w:r>/g, '');

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

  // If ghost-row stripping left a <w:tbl> with zero <w:tr>s, drop
  // the whole table. OOXML requires at least one row; an empty
  // <w:tbl> triggers Word's "We found a problem" repair dialog.
  xml = xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, table => {
    return /<w:tr\b/.test(table) ? table : '';
  });

  // 3. Every <w:tc> must contain at least one <w:p> per OOXML. The
  //    empty-paragraph strip above happily removes <w:p/> from
  //    otherwise-empty cells — source HTML with blank `<td></td>`
  //    cells therefore ships cells with only a <w:tcPr>, which fires
  //    Word's "We found a problem with some of the content" repair
  //    dialog on every open. Re-inject a minimal paragraph into any
  //    cell that ended up without one. Run AFTER the table/row strip
  //    passes so we don't waste work on cells in rows we're dropping.
  xml = xml.replace(/<w:tc\b([^>]*)>([\s\S]*?)<\/w:tc>/g, (full, attrs: string, inner: string) => {
    return /<w:p\b/.test(inner) ? full : `<w:tc${attrs}>${inner}<w:p/></w:tc>`;
  });

  // 4. Final integrity check. Every defect that reaches this point is
  //    a NEW pattern the auto-repair passes don't know about. We now
  //    THROW in production rather than just logging — shipping a
  //    broken .docx that Word can't open is worse than failing the
  //    generation with a clear error. The auditor sees a specific
  //    diagnostic ("table with no <w:tblGrid>", "empty <w:tc>", etc.)
  //    pointing at the bug in their template, instead of Word's
  //    generic "experienced an error trying to open the file" dialog
  //    that gives them no recourse.
  //
  //    AUDIT_DOCX_STRICT=0 reverts to the old log-only behaviour
  //    (broken file shipped, warnings in Vercel logs) for the rare
  //    case where downstream needs to see the corrupt output for
  //    debugging.
  const forceLenient = process.env.AUDIT_DOCX_STRICT === '0';
  validateAndLogDocxBodyXml(xml, 'htmlToDocxBody', forceLenient ? {} : { strict: true });

  return xml;
}
