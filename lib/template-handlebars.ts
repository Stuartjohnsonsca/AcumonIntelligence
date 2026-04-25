/**
 * Central Handlebars instance used by the document-template render
 * pipeline and the preview endpoint. All helpers the admin relies on
 * in templates live here — if a new one is added, register it here
 * and document it in the editor's "Available helpers" tooltip.
 *
 * Kept separate from the general-purpose Handlebars export so we can
 * lock down what's available to admin-authored templates (no access
 * to unsafe built-ins like `lookup` / `log`).
 */

import Handlebars from 'handlebars';

// Create a fresh, isolated instance rather than mutating the global
// one — keeps helper registration scoped and prevents cross-talk with
// any other Handlebars consumer in the app.
const hb = Handlebars.create();

// ─── Comparison helpers ────────────────────────────────────────────────────
hb.registerHelper('eq', (a: any, b: any) => a === b);
hb.registerHelper('ne', (a: any, b: any) => a !== b);
hb.registerHelper('gt', (a: any, b: any) => Number(a) > Number(b));
hb.registerHelper('lt', (a: any, b: any) => Number(a) < Number(b));
hb.registerHelper('gte', (a: any, b: any) => Number(a) >= Number(b));
hb.registerHelper('lte', (a: any, b: any) => Number(a) <= Number(b));
hb.registerHelper('and', (...args: any[]) => { args.pop(); return args.every(Boolean); });
hb.registerHelper('or', (...args: any[]) => { args.pop(); return args.some(Boolean); });
hb.registerHelper('not', (v: any) => !v);

// ─── Collection helpers ────────────────────────────────────────────────────
hb.registerHelper('isEmpty', (v: any) => {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  if (typeof v === 'string') return v.trim().length === 0;
  return false;
});
hb.registerHelper('length', (v: any) => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  if (typeof v === 'string') return v.length;
  return 0;
});
hb.registerHelper('join', (arr: any, sep: any) => {
  const s = typeof sep === 'string' ? sep : ', ';
  return Array.isArray(arr) ? arr.join(s) : '';
});

// ─── Date formatting ───────────────────────────────────────────────────────
/**
 * {{formatDate value "pattern"}}
 *
 * Patterns use a small subset of dayjs-style tokens: `yyyy`, `yy`,
 * `MMMM`, `MMM`, `MM`, `M`, `dd`, `d`. Defaults to "dd MMM yyyy" when
 * no pattern is given. Tolerant of falsy input (returns empty string).
 */
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = MONTHS_LONG.map(m => m.slice(0, 3));
hb.registerHelper('formatDate', (value: any, pattern?: any) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = typeof pattern === 'string' ? pattern : 'dd MMM yyyy';
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(-2);
  const M = d.getMonth();
  const day = d.getDate();
  return p
    .replace(/yyyy/g, yyyy)
    .replace(/yy/g, yy)
    .replace(/MMMM/g, MONTHS_LONG[M])
    .replace(/MMM/g, MONTHS_SHORT[M])
    .replace(/MM/g, String(M + 1).padStart(2, '0'))
    .replace(/\bM\b/g, String(M + 1))
    .replace(/dd/g, String(day).padStart(2, '0'))
    .replace(/\bd\b/g, String(day));
});

// ─── Arithmetic ────────────────────────────────────────────────────────────
/**
 * Inline math helpers for template expressions — Handlebars has NO
 * infix operator support, so `{{ a / b * 100 }}` is invalid. These
 * give the admin composable building blocks:
 *   {{add x y}}       x + y
 *   {{subtract x y}}  x - y   (alias: {{sub x y}})
 *   {{multiply x y}}  x * y   (alias: {{mul x y}})
 *   {{divide x y}}    x / y   (alias: {{div x y}}) — returns 0 on divide-by-zero
 *
 * Non-numeric inputs are coerced via Number(); anything that returns
 * NaN produces 0 so formatters downstream don't print "NaN".
 */
function toNum(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
hb.registerHelper('add',      (a: any, b: any) => toNum(a) + toNum(b));
hb.registerHelper('subtract', (a: any, b: any) => toNum(a) - toNum(b));
hb.registerHelper('sub',      (a: any, b: any) => toNum(a) - toNum(b));
hb.registerHelper('multiply', (a: any, b: any) => toNum(a) * toNum(b));
hb.registerHelper('mul',      (a: any, b: any) => toNum(a) * toNum(b));
hb.registerHelper('divide',   (a: any, b: any) => { const d = toNum(b); return d === 0 ? 0 : toNum(a) / d; });
hb.registerHelper('div',      (a: any, b: any) => { const d = toNum(b); return d === 0 ? 0 : toNum(a) / d; });

/**
 * {{percent numerator denominator decimals?}}
 *
 * Convenience helper that computes `(numerator / denominator) * 100`
 * and formats to N decimals with a trailing % sign. Defaults to 2 dp
 * — the common materiality case. Returns empty string on divide-by-
 * zero so the template doesn't emit "NaN%".
 *
 * Example: PM as % of overall materiality to 2 dp:
 *   {{percent materiality.performance materiality.overall}} → "70.00%"
 *   {{percent materiality.performance materiality.overall 1}} → "70.0%"
 *   {{percent materiality.performance materiality.overall 0}} → "70%"
 */
hb.registerHelper('percent', (num: any, den: any, decimals?: any) => {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return '';
  const dp = typeof decimals === 'number' && Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 2;
  return `${((n / d) * 100).toFixed(dp)}%`;
});

// ─── Date arithmetic ───────────────────────────────────────────────────────
/**
 * {{dateAdd value amount "unit"}}
 *
 * Returns an ISO-yyyy-mm-dd string offset from `value` by `amount`
 * units. Positive `amount` moves forward, negative moves back.
 * `unit` is one of: years | months | weeks | days. Defaults to days.
 *
 * Designed to compose with {{formatDate}} as a subexpression, e.g.
 *   {{formatDate (dateAdd period.periodStart -1 "years") "dd/MM/yy"}}
 *
 * Returns '' on a falsy value, mirroring formatDate's behaviour.
 */
function parseDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
hb.registerHelper('dateAdd', (value: any, amount: any, unit?: any) => {
  const d = parseDate(value);
  if (!d) return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return toIso(d);
  const u = typeof unit === 'string' ? unit.toLowerCase() : 'days';
  if (u === 'years' || u === 'year' || u === 'y') d.setFullYear(d.getFullYear() + n);
  else if (u === 'months' || u === 'month' || u === 'mo') d.setMonth(d.getMonth() + n);
  else if (u === 'weeks' || u === 'week' || u === 'w') d.setDate(d.getDate() + n * 7);
  else d.setDate(d.getDate() + n);
  return toIso(d);
});

/** Sugar for the common cases. `addYears x 1` reads more naturally
 *  than `dateAdd x 1 "years"` in templates. */
hb.registerHelper('addYears',      (v: any, n: any) => { const d = parseDate(v); if (!d) return ''; d.setFullYear(d.getFullYear() + (Number(n) || 0)); return toIso(d); });
hb.registerHelper('subtractYears', (v: any, n: any) => { const d = parseDate(v); if (!d) return ''; d.setFullYear(d.getFullYear() - (Number(n) || 0)); return toIso(d); });
hb.registerHelper('addMonths',     (v: any, n: any) => { const d = parseDate(v); if (!d) return ''; d.setMonth(d.getMonth() + (Number(n) || 0)); return toIso(d); });
hb.registerHelper('subtractMonths',(v: any, n: any) => { const d = parseDate(v); if (!d) return ''; d.setMonth(d.getMonth() - (Number(n) || 0)); return toIso(d); });
hb.registerHelper('addDays',       (v: any, n: any) => { const d = parseDate(v); if (!d) return ''; d.setDate(d.getDate() + (Number(n) || 0)); return toIso(d); });
hb.registerHelper('subtractDays',  (v: any, n: any) => { const d = parseDate(v); if (!d) return ''; d.setDate(d.getDate() - (Number(n) || 0)); return toIso(d); });

// ─── Currency formatting ───────────────────────────────────────────────────
/**
 * {{formatCurrency value "GBP"}}
 *
 * Defaults to GBP and 0 decimals. Negatives render in accounting
 * parens (1,234) rather than a minus sign.
 */
hb.registerHelper('formatCurrency', (value: any, currencyArg?: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const currency = typeof currencyArg === 'string' ? currencyArg : 'GBP';
  const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };
  const sym = symbols[currency] ?? '';
  const abs = Math.abs(num);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num < 0 ? `(${sym}${s})` : `${sym}${s}`;
});

hb.registerHelper('formatNumber', (value: any, decimals?: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const d = typeof decimals === 'number' ? decimals : 0;
  return num.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
});

hb.registerHelper('formatPercent', (value: any, decimals?: any) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const d = typeof decimals === 'number' ? decimals : 1;
  return `${num.toFixed(d)}%`;
});

// ─── Aggregation helpers ───────────────────────────────────────────────────
/**
 * {{sumField arr "fieldName"}} → numeric sum of that field across
 * every item in the array. Non-numeric values are treated as 0.
 * Returns 0 when the array is missing or empty so it's safe inside
 * {{formatCurrency}} etc.
 */
hb.registerHelper('sumField', (arr: any, fieldName: any) => {
  if (!Array.isArray(arr)) return 0;
  const field = String(fieldName);
  let total = 0;
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const v = Number(item[field]);
      if (Number.isFinite(v)) total += v;
    }
  }
  return Math.round(total * 100) / 100;
});

/**
 * {{sumFieldWhere arr "sumField" "filterField" "op" "value"}}
 * Filter-then-sum in one call — used when a dynamic-table's total
 * row should respect the same filter that drove the visible rows.
 * `op` is one of 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' |
 * 'contains' | 'isEmpty' | 'isNotEmpty'. For isEmpty / isNotEmpty
 * the `value` argument is ignored (empty means null/undefined/"").
 */
function opPasses(operator: string, itemVal: any, target: any): boolean {
  switch (operator) {
    case 'eq': return itemVal == target;
    case 'ne': return itemVal != target;
    case 'gt': return Number(itemVal) > Number(target);
    case 'lt': return Number(itemVal) < Number(target);
    case 'gte': return Number(itemVal) >= Number(target);
    case 'lte': return Number(itemVal) <= Number(target);
    case 'contains': return String(itemVal ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
    case 'isEmpty':
      return itemVal === null || itemVal === undefined
        || (typeof itemVal === 'string' && itemVal.trim() === '')
        || (Array.isArray(itemVal) && itemVal.length === 0);
    case 'isNotEmpty':
      return !(itemVal === null || itemVal === undefined
        || (typeof itemVal === 'string' && itemVal.trim() === '')
        || (Array.isArray(itemVal) && itemVal.length === 0));
    default: return true;
  }
}
hb.registerHelper('sumFieldWhere', (arr: any, sumField: any, filterField: any, op: any, filterValue: any) => {
  if (!Array.isArray(arr)) return 0;
  const sumKey = String(sumField);
  const filtKey = String(filterField);
  const operator = String(op);
  let total = 0;
  for (const item of arr) {
    if (item && typeof item === 'object' && opPasses(operator, item[filtKey], filterValue)) {
      const v = Number(item[sumKey]);
      if (Number.isFinite(v)) total += v;
    }
  }
  return Math.round(total * 100) / 100;
});

/**
 * {{#each (filterWhere arr "field" "op" value)}}
 *
 * General-purpose filter — returns a new array of items where
 * `item[field]` passes the operator check against `value`. Ops are
 * the same set the sumFieldWhere helper supports: eq / ne / gt / lt /
 * gte / lte / contains / isEmpty / isNotEmpty.
 *
 * The workhorse behind `filterBySection` below, but also useful for
 * one-off filters in templates — e.g. iterate only rows where a
 * trigger column is set to a particular value.
 */
hb.registerHelper('filterWhere', (arr: any, field: any, op: any, value: any) => {
  if (!Array.isArray(arr)) return [];
  const fieldKey = String(field);
  const operator = String(op);
  return arr.filter(item => item && typeof item === 'object' && opPasses(operator, item[fieldKey], value));
});

/**
 * {{#each (filterBySection asList "Section Name")}}
 *
 * Filters a questionnaire's `asList` array down to the entries that
 * belong to the named section. Matching is case-insensitive and
 * tolerant of punctuation/whitespace differences, so the admin
 * doesn't have to worry about whether the section was stored as
 * "Non Audit Services" vs "non_audit_services" vs "NonAuditServices".
 *
 * The killer use case is rendering a section's questions as a table
 * in a document template, which can't be done with a plain
 * `{{#each asList}}` (which would render every section's questions
 * interleaved). Example:
 *
 *   {{#each (filterBySection questionnaires.ethics.asList "Non Audit Services")}}
 *     <tr>
 *       <td>{{question}}</td>
 *       <td>{{answer}}</td>
 *     </tr>
 *   {{/each}}
 *
 * Returns [] for unknown sections or non-array input — templates can
 * wrap the loop in {{#if (length filtered)}} to branch on presence.
 */
hb.registerHelper('filterBySection', (arr: any, sectionName: any) => {
  if (!Array.isArray(arr) || sectionName == null) return [];
  const normalise = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = normalise(sectionName);
  if (!target) return [];
  return arr.filter(item => normalise(item?.section) === target);
});

/** {{#if (isNotEmpty x)}}...{{/if}} — sibling of the existing
 *  `isEmpty` so filter clauses generated by the dynamic-table
 *  modal can use either polarity without a `not` wrapper. */
hb.registerHelper('isNotEmpty', (v: any) => !(
  v === null || v === undefined
  || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && Object.keys(v).length === 0)
));

/**
 * {{#if (isYes value)}} ... {{/if}}
 *
 * Truthy when `value` looks like an affirmative yes/no answer in any
 * of the formats schedule renderers save them in:
 *   "Y" / "Yes" / "yes" / "true" / true / 1 / "1" / "T" / "t"
 *
 * Document templates can use this in place of `(eq value "Y")` when
 * they're not sure whether the source tab will save "Y" / "true" /
 * boolean true. Mirrors the context-level normaliser in
 * template-context.ts so behaviour is consistent on both sides.
 */
hb.registerHelper('isYes', (v: any) => {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 't';
});

/**
 * {{#if (isNo value)}} ... {{/if}}
 *
 * The polar opposite of `isYes`. Returns true ONLY for explicit "no"
 * answers — empty / null / unrecognised values return false (so a
 * template can distinguish "answered No" from "not answered").
 */
hb.registerHelper('isNo', (v: any) => {
  if (v === false) return true;
  if (v === true) return false;
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'n' || s === 'no' || s === 'false' || s === '0' || s === 'f';
});

/** {{countItems arr}} → length of the array (0 if not an array). */
hb.registerHelper('countItems', (arr: any) => Array.isArray(arr) ? arr.length : 0);

// ─── String helpers ────────────────────────────────────────────────────────
hb.registerHelper('upper', (v: any) => String(v ?? '').toUpperCase());
hb.registerHelper('lower', (v: any) => String(v ?? '').toLowerCase());
hb.registerHelper('titleCase', (v: any) => String(v ?? '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()));
// `default` returns the first argument that is not null / undefined /
// empty string. Variadic — admins can chain any number of fallbacks in
// a template (e.g. when the same conceptual value is stored in
// different places depending on the firm's data discipline):
//   {{default client.registeredAddress questionnaires.permanentFile.entity_address}}
//   {{default questionnaires.ethics.contact questionnaires.continuance.contact client.contactName}}
// The last arg passed by Handlebars is an options object and must be
// dropped before checking.
hb.registerHelper('default', function (...args: any[]) {
  args.pop(); // Handlebars options object
  for (const v of args) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return '';
});

// ─── Table rendering helpers ───────────────────────────────────────────────
/**
 * {{{errorScheduleTable errorSchedule}}}
 *
 * Returns an HTML table for use inside the body HTML. Must be invoked
 * with TRIPLE braces so Handlebars doesn't escape the returned HTML.
 * Empty array returns an empty string so the helper composes with
 * {{#if}} cleanly.
 */
hb.registerHelper('errorScheduleTable', (rows: any) => {
  if (!Array.isArray(rows) || rows.length === 0) return new hb.SafeString('');
  const escape = Handlebars.escapeExpression;
  const body = rows.map(r => {
    const amt = Number(r?.amount ?? 0);
    const fmtAmt = amt < 0
      ? `(£${Math.abs(amt).toLocaleString('en-GB')})`
      : `£${amt.toLocaleString('en-GB')}`;
    return `<tr>
      <td>${escape(r?.fsLine ?? '')}</td>
      <td>${escape(r?.description ?? '')}</td>
      <td style="text-align:right">${escape(fmtAmt)}</td>
      <td>${escape(r?.errorType ?? '')}</td>
    </tr>`;
  }).join('');
  const html = `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead><tr><th>FS Line</th><th>Description</th><th style="text-align:right">Amount</th><th>Type</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
  return new hb.SafeString(html);
});

/** {{{testConclusionsTable testConclusions}}} — same pattern. */
hb.registerHelper('testConclusionsTable', (rows: any) => {
  if (!Array.isArray(rows) || rows.length === 0) return new hb.SafeString('');
  const escape = Handlebars.escapeExpression;
  const body = rows.map(r => `<tr>
    <td>${escape(r?.fsLine ?? '')}</td>
    <td>${escape(r?.testDescription ?? '')}</td>
    <td>${escape(r?.conclusion ?? '')}</td>
    <td style="text-align:right">£${Number(r?.totalErrors ?? 0).toLocaleString('en-GB')}</td>
  </tr>`).join('');
  return new hb.SafeString(`<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead><tr><th>FS Line</th><th>Test</th><th>Conclusion</th><th style="text-align:right">Errors</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`);
});

// ─── Handlebars-safe sanitiser ─────────────────────────────────────────────
/**
 * contentEditable editors (ours included) routinely split text across
 * `<span>` runs whenever inline styling changes — e.g. typing inside
 * a span that inherits `color: rgb(...)` from the surrounding element.
 * The result is that a token the admin sees as a single `{{formatDate
 * x "dd MMM yyyy"}}` ends up stored as:
 *
 *     {{formatDate</span><span style="color: rgb(2,8,23);"> x "dd MMM yyyy"}}
 *
 * Handlebars can't parse that. This helper walks the HTML and, inside
 * every `{{ ... }}` pair, strips any `<...>` tag fragments and decodes
 * HTML entities, leaving clean Handlebars tokens. The surrounding HTML
 * outside of `{{ ... }}` is left untouched.
 *
 * Applied at BOTH save-time (in the editor) and render-time (here)
 * so pre-existing corrupted templates still render while new saves
 * are kept clean going forward.
 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
};
function decodeEntitiesInToken(s: string): string {
  let out = s;
  for (const [ent, ch] of Object.entries(ENTITIES)) out = out.split(ent).join(ch);
  out = out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
           .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return out;
}

export function sanitiseHandlebarsInHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return html;

  // ── First pass: unwrap HTML-comment-wrapped Handlebars tokens ─────
  //
  // Background: HTML parsers apply "foster parenting" — stray text
  // inside <table>, <tbody>, <thead>, <tfoot>, <tr>, <colgroup> is
  // illegal, so the parser moves it BEFORE the table. For templates
  // that want a {{#each}} around a <tr>, this is fatal — the block
  // tokens end up outside the table and the row becomes an orphan.
  //
  // HTML comments, in contrast, ARE allowed between those elements.
  // So the convention for any template with Handlebars inside table
  // structure is to wrap the block tokens in comments:
  //
  //   <tbody>
  //     <!--{{#each (filterBySection foo "Bar")}}-->
  //     <tr>…</tr>
  //     <!--{{/each}}-->
  //   </tbody>
  //
  // At render time we strip the comment wrappers so Handlebars sees
  // the plain tokens. Works even when the comment wraps a whole
  // multi-line block because `[\s\S]*?` matches newlines. Templates
  // written without comment wrappers (e.g. inside a <p>, <div>,
  // <li>) keep working unchanged — the regex only matches actual
  // `<!--…-->` sequences.
  html = html.replace(/<!--\s*(\{\{[\s\S]*?\}\})\s*-->/g, '$1');

  let out = '';
  let i = 0;
  const n = html.length;
  while (i < n) {
    // Found the start of a Handlebars token? Scan forward for the
    // (outermost) matching `}}`, stripping any `<tag>` sequences and
    // any NESTED `{{…}}` braces along the way.
    //
    // Two corruption modes this defends against:
    //   (a) contentEditable split the token across `<span>` runs —
    //       typical when the admin types inside an inherited colour
    //       or a merge-field pill gets inserted into a styled range.
    //   (b) the admin accidentally nested braces, e.g. clicking a
    //       pill inside an existing `{{...}}` produces
    //       `{{formatDate{{period.periodEnd}} "dd MMM yyyy"}}`.
    //       Handlebars helpers take space-separated arguments, so
    //       the inner `{{...}}` wrapping is a syntax error — we just
    //       collapse it to the bare path.
    if (html[i] === '{' && html[i + 1] === '{') {
      let cursor = i + 2;
      let cleanInner = '';
      let closed = false;
      // Depth tracks nested `{{`s so we match the OUTERMOST `}}` only
      // when we're back at depth 0. The nested inner braces get
      // discarded (they'd be invalid Handlebars anyway) while their
      // contained text is preserved.
      let depth = 0;
      while (cursor < n) {
        // Closing `}}`?
        if (html[cursor] === '}' && html[cursor + 1] === '}') {
          if (depth === 0) { cursor += 2; closed = true; break; }
          depth--;
          cursor += 2;
          continue; // skip the nested close braces entirely
        }
        // Opening `{{`?
        if (html[cursor] === '{' && html[cursor + 1] === '{') {
          depth++;
          cursor += 2;
          continue; // skip the nested open braces entirely
        }
        if (html[cursor] === '<') {
          // Skip the whole tag. A stray `<` with no `>` terminates
          // the scan — treat the `{{` as non-Handlebars text.
          const end = html.indexOf('>', cursor);
          if (end < 0) break;
          cursor = end + 1;
        } else {
          cleanInner += html[cursor];
          cursor++;
        }
      }
      if (closed) {
        // Collapse runs of whitespace the nested-brace skip may have
        // left behind, then re-emit the cleaned token.
        const collapsed = decodeEntitiesInToken(cleanInner).replace(/\s+/g, ' ').trim();
        out += '{{' + collapsed + '}}';
        i = cursor;
        continue;
      }
      // Fall through to the single-char emit below if we never closed.
    }
    out += html[i];
    i++;
  }
  return out;
}

// ─── Compile + render wrapper ──────────────────────────────────────────────
export interface RenderResult {
  html: string;
  error: string | null;
}

/**
 * Compile + run a body template against a context. Sanitises any
 * contentEditable-split Handlebars tokens first so legacy saves
 * still render. Returns the rendered HTML (or empty string on
 * compile error, with `error` set).
 */
export function renderBody(bodyTemplate: string, context: any): RenderResult {
  try {
    const clean = sanitiseHandlebarsInHtml(bodyTemplate);
    const tpl = hb.compile(clean, { strict: false, noEscape: false });
    return { html: tpl(context), error: null };
  } catch (err: any) {
    return { html: '', error: err?.message || 'Template compile / render failed' };
  }
}

/**
 * Extract every `{{path}}` (and `{{#if path}}`, `{{#each path}}`) from
 * a template source — used by the preview endpoint to tell the admin
 * which placeholders aren't covered by the catalog. Strips helper
 * names so `{{formatDate period.periodEnd "dd MMM yyyy"}}` yields
 * `period.periodEnd`, not the helper name.
 */
export function extractReferencedPaths(bodyTemplate: string): string[] {
  // Run the same sanitiser that the compile step uses so paths we
  // extract reflect what the Handlebars compiler will actually see —
  // otherwise span-split tokens produce spurious "missing" entries.
  const clean = sanitiseHandlebarsInHtml(bodyTemplate);
  const re = /\{\{\{?\s*([^}]*?)\s*\}?\}\}/g;
  const paths = new Set<string>();
  // Common loop-item field names that appear inside {{#each …}} blocks
  // as bare references (e.g. {{name}}, {{milestone}}). These match
  // itemFields declared on catalog arrays (errorSchedule, auditTimetable,
  // auditPlan.risks, questionnaires.*.asList). Skipping them here means
  // they don't show up as false-positive "missing" placeholders — only
  // a true typo at the top level gets flagged.
  const LOOP_ITEM_FIELDS = new Set([
    // Generic
    'id','name','description','type','status','notes','sortOrder','amount',
    // Engagement team
    'role','email',
    // Error schedule
    'fsLine','accountCode','errorType','resolution','explanation','isFraud',
    // Test conclusions / audit plan
    'testDescription','conclusion','totalErrors','extrapolatedError','auditorNotes',
    'reviewedByName','riSignedByName',
    // Audit timetable
    'milestone','targetDate','revisedTarget','progress',
    // Audit risks (RMM)
    'assertions','relevance','complexityText','subjectivityText','changeText',
    'uncertaintyText','susceptibilityText','inherentRiskLevel','aiSummary',
    'likelihood','magnitude','finalRiskAssessment','controlRisk','overallRisk',
    'rowCategory','fsStatement','fsLevel',
    // Questionnaires asList
    'question','answer','section','key','itemIndex','isEmpty',
    'previousKey','previousQuestion','previousAnswer',
    'nextKey','nextQuestion','nextAnswer',
    // TB rows
    'accountCode','currentYear','priorYear','fsStatement','fsLevel','fsLine',
  ]);
  const KNOWN_HELPERS = new Set([
    'if','unless','each','with','lookup','log',
    'eq','ne','gt','lt','gte','lte','and','or','not',
    'isEmpty','isNotEmpty','isYes','isNo','length','join',
    'formatDate','formatCurrency','formatNumber','formatPercent',
    'dateAdd','addYears','subtractYears','addMonths','subtractMonths','addDays','subtractDays',
    'add','subtract','sub','multiply','mul','divide','div','percent',
    'upper','lower','titleCase','default',
    'errorScheduleTable','testConclusionsTable',
    'sumField','sumFieldWhere','countItems',
    // Array filters — the #each block wraps an array result and passes
    // item fields via LOOP_ITEM_FIELDS below. These helpers themselves
    // must not appear as "missing placeholders".
    'filterWhere','filterBySection',
    'paragraph','else',
  ]);

  /** Tokenise the inner body of a `{{ … }}` expression while respecting:
   *    • single/double-quoted string literals (treated as ONE opaque token)
   *    • parentheses (sub-expressions — stripped so inner tokens are seen)
   *    • hash-prefixed block names (`#if`, `#each`, `#with`)
   *  Returns a flat array of "candidate" tokens — paths or helper names. */
  function tokenise(s: string): string[] {
    const out: string[] = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
      const ch = s[i];
      // Skip whitespace and bare punctuation that separates tokens.
      if (/\s/.test(ch) || ch === '(' || ch === ')') { i++; continue; }
      // Quoted string literal — consume through matching close quote.
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        while (i < n && s[i] !== quote) {
          if (s[i] === '\\' && i + 1 < n) i++; // skip escape
          i++;
        }
        i++; // skip closing quote (or advance past end)
        continue; // skip entirely — literal, not a path
      }
      // Accumulate a token up to the next whitespace / paren / quote.
      let start = i;
      while (i < n && !/[\s()]/.test(s[i]) && s[i] !== '"' && s[i] !== "'") i++;
      if (i > start) out.push(s.slice(start, i));
    }
    return out;
  }

  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    let inner = (m[1] || '').trim();
    if (!inner) continue;
    // Strip leading block markers (#if, /each, #each, #unless, else, etc.)
    inner = inner.replace(/^([#/])/, '$1 ').replace(/\s*~\s*/g, ' ').trim();
    const tokens = tokenise(inner);
    for (let t of tokens) {
      // Drop `else` / `#if` / `/each` etc. — not paths.
      t = t.replace(/^[#/]/, '');
      if (!t) continue;
      // Numbers, booleans, null/undefined.
      if (/^-?\d+(\.\d+)?$/.test(t)) continue;
      if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') continue;
      // Known helpers.
      if (KNOWN_HELPERS.has(t)) continue;
      // Loop-item refs inside {{#each}} — not top-level paths.
      if (LOOP_ITEM_FIELDS.has(t)) continue;
      // Handlebars conveniences.
      if (t === 'this' || t === '.' || t === 'else') continue;
      if (t.startsWith('../') || t.startsWith('@')) continue; // block-scoped refs
      if (t.startsWith('this.')) continue; // loop-item lookups via `this`
      // `role=='Reviewer'` and other ill-formed inline comparisons are
      // reported as Handlebars parse errors — skip them here so we
      // don't double-flag.
      if (/[=<>!]/.test(t) || t.includes('&&') || t.includes('||')) continue;
      paths.add(t);
    }
  }
  return Array.from(paths);
}

/**
 * Per-loop output reference. Describes a single placeholder INSIDE
 * a `{{#each ... questionnaires.<X>.asList ...}} ... {{/each}}` body
 * — i.e. a value the template writes into the rendered document.
 *
 * Used by the schedule form to draw red outlines on cells that
 * actually flow into a template. Filter ARGUMENTS (col1 / threat
 * inside `filterWhere ...`) are CHECK conditions, not outputs, and
 * are deliberately excluded.
 */
export interface TemplateOutputRef {
  /** ctxKey of the questionnaire being looped over (e.g. 'ethics'). */
  questionnaireKey: string;
  /** Section name from `filterBySection ... "<name>"`, or null when
   *  the loop iterates the whole schedule (all sections). */
  sectionName: string | null;
  /** col<N> body placeholders — col1, col2, col3 ...  Null when the
   *  body uses {{question}} / {{answer}} / a slug alias instead. */
  colN: number | null;
  /** Header-slug body placeholder (e.g. 'threat_description'). The
   *  API endpoint resolves these to col<N> via the schedule's
   *  sectionMeta before exposing them to the schedule form. */
  slug: string | null;
  /** {{answer}} body placeholder — present in plain Q+A loops over
   *  standard-layout sections. */
  isAnswer: boolean;
  /** {{question}} body placeholder — references the row label /
   *  question text, which is the col0 label column. Currently used
   *  for tooltip context only; cells aren't outlined for this. */
  isQuestion: boolean;
}

/**
 * Walk every `{{#each <arr>}} ... {{/each}}` block whose array
 * resolves (after peeling filterWhere/filterBySection wrappers) to
 * `questionnaires.<X>.asList`, and collect the placeholders the
 * loop body uses.
 *
 * Limitations (intentional — scope is "useful red outlines",
 * not full Handlebars semantics):
 *   • Nested `{{#each}}` over a different array inside the body
 *     attributes its placeholders to the OUTER loop too — a small
 *     overcount, no false negatives.
 *   • `{{lookup this "Threat exists?"}}` style verbatim-header
 *     references aren't parsed; admins can use the slug form
 *     ({{threat_exists}}) and they'll be detected.
 *   • Block markers like `{{#if}}…{{/if}}` inside the body are
 *     stepped over when scanning for placeholders.
 */
export function extractTemplateOutputs(bodyTemplate: string): TemplateOutputRef[] {
  const clean = sanitiseHandlebarsInHtml(bodyTemplate);
  const out: TemplateOutputRef[] = [];

  // Scan for `{{#each ...}}` opening tokens, then walk forward
  // tracking each-depth so we capture the matching `{{/each}}`. We
  // don't try to parse the FULL body — just the ones that touch
  // `asList` so the cost stays low even on big templates.
  const eachOpenRe = /\{\{\s*#each\b([^}]*)\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = eachOpenRe.exec(clean)) !== null) {
    const expr = (m[1] || '').trim();
    // Quick filter — must mention `asList` (so we ignore each-loops
    // over errorSchedule / tb.rows / etc.).
    if (!/\basList\b/.test(expr)) continue;

    // Find the schedule's ctxKey from the path `questionnaires.<X>.asList`.
    const ctxMatch = expr.match(/questionnaires\.([A-Za-z0-9_]+)\.asList\b/);
    if (!ctxMatch) continue;
    const questionnaireKey = ctxMatch[1];

    // Section filter — `filterBySection <arr> "Section Name"`.
    let sectionName: string | null = null;
    const fbsMatch = expr.match(/filterBySection[^"']*["']([^"']+)["']/);
    if (fbsMatch) sectionName = fbsMatch[1];

    // Find the matching `{{/each}}`. Walk forward maintaining depth so
    // a nested `{{#each}}` inside the body doesn't close ours early.
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    const inner = /\{\{\s*(#each|\/each)\b[^}]*\}\}/gi;
    inner.lastIndex = bodyStart;
    let bodyEnd = -1;
    let im: RegExpExecArray | null;
    while ((im = inner.exec(clean)) !== null) {
      if (/^#each\b/i.test(im[1])) depth++;
      else { depth--; if (depth === 0) { bodyEnd = im.index; break; } }
    }
    if (bodyEnd < 0) continue; // unbalanced — skip
    const body = clean.slice(bodyStart, bodyEnd);

    // Continue the outer scan AFTER this loop's closing tag so we
    // don't reparse nested each-opens we already counted.
    eachOpenRe.lastIndex = bodyEnd;

    // Scan body for placeholder tokens — `{{xxx}}` where xxx is a
    // single bare identifier (not a helper, not a sub-expression).
    // Specifically: skip `{{#…}}` / `{{/…}}` block markers and any
    // expression with whitespace / parens (those carry helpers, e.g.
    // `{{formatDate col1 "..."}}` — the body still references col1,
    // which we want, so we ALSO scan helper expressions for
    // identifiers that match our output-shape rules).
    const phRe = /\{\{\{?\s*([^}]*?)\s*\}?\}\}/g;
    let pm: RegExpExecArray | null;
    while ((pm = phRe.exec(body)) !== null) {
      let s = (pm[1] || '').trim();
      if (!s) continue;
      if (/^[#/]/.test(s)) continue; // block markers
      if (s === 'else') continue;
      // Tokenise — skip strings/parens — and pick the bare
      // identifiers that look like output references.
      const toks = (() => {
        const arr: string[] = [];
        let i = 0;
        while (i < s.length) {
          const ch = s[i];
          if (/\s/.test(ch) || ch === '(' || ch === ')') { i++; continue; }
          if (ch === '"' || ch === "'") {
            const q = ch; i++;
            while (i < s.length && s[i] !== q) { if (s[i] === '\\' && i + 1 < s.length) i++; i++; }
            i++;
            continue;
          }
          let start = i;
          while (i < s.length && !/[\s()]/.test(s[i]) && s[i] !== '"' && s[i] !== "'") i++;
          if (i > start) arr.push(s.slice(start, i));
        }
        return arr;
      })();

      for (const t of toks) {
        // Skip helper names — they're never output references.
        if (/^(if|unless|each|with|formatDate|formatCurrency|formatNumber|formatPercent|dateAdd|addYears|subtractYears|addMonths|subtractMonths|addDays|subtractDays|add|subtract|sub|multiply|mul|divide|div|percent|upper|lower|titleCase|default|join|length|isEmpty|isNotEmpty|countItems|sumField|sumFieldWhere|filterWhere|filterBySection|errorScheduleTable|testConclusionsTable|paragraph|else|eq|ne|gt|lt|gte|lte|and|or|not|lookup|log)$/.test(t)) continue;
        if (/^-?\d+(\.\d+)?$/.test(t)) continue;
        if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') continue;
        if (t.startsWith('../') || t.startsWith('@') || t === 'this' || t === '.' || t.startsWith('this.')) continue;
        // Dotted top-level paths (e.g. `period.periodEnd`) — also not
        // a loop-local reference; they're handled by extractReferencedPaths.
        if (t.includes('.')) continue;

        const colMatch = /^col(\d+)$/.exec(t);
        if (colMatch) {
          out.push({ questionnaireKey, sectionName, colN: Number(colMatch[1]), slug: null, isAnswer: false, isQuestion: false });
        } else if (t === 'answer') {
          out.push({ questionnaireKey, sectionName, colN: null, slug: null, isAnswer: true, isQuestion: false });
        } else if (t === 'question') {
          out.push({ questionnaireKey, sectionName, colN: null, slug: null, isAnswer: false, isQuestion: true });
        } else if (/^[a-z][a-z0-9_]*$/i.test(t)) {
          // Lowercase identifier — treat as a header slug. The API
          // endpoint resolves these to col<N> using the schedule's
          // sectionMeta before exposing them to the schedule form.
          // Things like 'previousAnswer' / 'nextKey' are loop-meta,
          // not outputs — skip them.
          if (/^(question|answer|key|section|sortOrder|itemIndex|isEmpty|previousKey|previousQuestion|previousAnswer|nextKey|nextQuestion|nextAnswer)$/.test(t)) continue;
          out.push({ questionnaireKey, sectionName, colN: null, slug: t, isAnswer: false, isQuestion: false });
        }
      }
    }
  }
  return out;
}

export default hb;
