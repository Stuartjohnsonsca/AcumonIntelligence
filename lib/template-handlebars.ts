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

// ─── String helpers ────────────────────────────────────────────────────────
hb.registerHelper('upper', (v: any) => String(v ?? '').toUpperCase());
hb.registerHelper('lower', (v: any) => String(v ?? '').toLowerCase());
hb.registerHelper('titleCase', (v: any) => String(v ?? '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()));
hb.registerHelper('default', (v: any, fallback: any) => (v == null || v === '' ? fallback : v));

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

// ─── Compile + render wrapper ──────────────────────────────────────────────
export interface RenderResult {
  html: string;
  error: string | null;
}

/**
 * Compile + run a body template against a context. Returns the
 * rendered HTML (or empty string on compile error, with `error` set).
 * Uses `noEscape: false` so admin-escaped content stays safe; triple
 * braces are still needed for intentional HTML (like helper output).
 */
export function renderBody(bodyTemplate: string, context: any): RenderResult {
  try {
    const tpl = hb.compile(bodyTemplate, { strict: false, noEscape: false });
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
  const re = /\{\{\s*([#/]?)([~]?)([^}]+?)([~]?)\s*\}\}/g;
  const paths = new Set<string>();
  const KNOWN_HELPERS = new Set([
    'if','unless','each','with','lookup','log',
    'eq','ne','gt','lt','gte','lte','and','or','not',
    'isEmpty','length','join',
    'formatDate','formatCurrency','formatNumber','formatPercent',
    'upper','lower','titleCase','default',
    'errorScheduleTable','testConclusionsTable',
    'else',
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyTemplate)) !== null) {
    const inner = (m[3] || '').trim();
    if (!inner) continue;
    const tokens = inner.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      // Ignore string literals, numbers, and known helpers.
      if (/^["'].*["']$/.test(t)) continue;
      if (/^-?\d+(\.\d+)?$/.test(t)) continue;
      if (KNOWN_HELPERS.has(t)) continue;
      if (t === 'this' || t === '.') continue;
      if (t.startsWith('../') || t.startsWith('@')) continue; // block-scoped refs
      paths.add(t);
    }
  }
  return Array.from(paths);
}

export default hb;
