/**
 * Safe client-side formula engine for audit appendix computed fields.
 * Supports: IF, SUM, ROUND, INDEX/MATCH, basic arithmetic, cell refs.
 * No eval() - uses a recursive descent parser.
 */

type FormValues = Record<string, string | number | boolean | null>;

/**
 * Normalise a question's text into a snake_case identifier suitable for use
 * as a formula variable name. "Audit Fee" → "audit_fee"; "% of Total Fees to
 * Firm Fees" → "pct_of_total_fees_to_firm_fees". Empty / non-string input
 * returns an empty string.
 */
export function slugifyQuestionText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/%/g, ' pct ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build a FormValues map that exposes both the canonical id keys AND
 * slug-derived aliases from each question's text. Collisions are
 * disambiguated with a numeric suffix (_2, _3, …). Callers merge this with
 * any engagement-level overrides and firm-wide variables before handing
 * the result to evaluateFormula.
 */
export function buildFormulaValues(
  questions: Array<{ id: string; questionText?: string | null }>,
  values: FormValues,
): FormValues {
  const out: FormValues = { ...values };
  const used = new Set<string>(Object.keys(out));
  for (const q of questions) {
    if (!q.id) continue;
    const baseSlug = slugifyQuestionText(q.questionText);
    if (!baseSlug) continue;
    // Don't clobber an existing exact match (happens when a question's id
    // itself is already snake_case, e.g. seeded templates).
    if (baseSlug === q.id) continue;
    let slug = baseSlug;
    let n = 2;
    while (used.has(slug) && out[slug] !== values[q.id]) {
      slug = `${baseSlug}_${n++}`;
    }
    used.add(slug);
    out[slug] = values[q.id] ?? null;
  }
  return out;
}

export function evaluateFormula(
  expression: string,
  values: FormValues,
  crossRefValues?: Record<string, FormValues>
): string | number | boolean | null {
  if (!expression) return null;

  try {
    // First pass: replace {fieldId} / {appendix.fieldId} references
    let resolved = resolveReferences(expression, values, crossRefValues);
    // Second pass: also replace bare identifiers that match a value name.
    // A bare identifier is any snake_case / camelCase token NOT preceded by
    // a letter/digit/underscore and NOT inside a quoted string. This lets
    // admins write `audit_fee + non_audit_fee` without having to wrap every
    // reference in braces — closer to Excel-style references.
    resolved = resolveBareIdentifiers(resolved, values);
    return parseExpression(resolved.trim());
  } catch {
    return null; // Gracefully return null on any parse error
  }
}

/** Known formula function names that must NOT be treated as value references. */
const FORMULA_FUNCTIONS = new Set([
  'IF', 'SUM', 'ROUND', 'OR', 'AND', 'TRUE', 'FALSE', 'INDEX', 'MATCH',
  // Aggregations + common maths — added for percentage / averaging workflows.
  'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ABS', 'PERCENT', 'PCT',
]);

/**
 * Replace bare identifiers with their values from `values`. Skips anything
 * inside double-quoted string literals and anything immediately followed by
 * `(` (function calls).
 */
function resolveBareIdentifiers(expr: string, values: FormValues): string {
  // Walk the expression character-by-character so we can skip quoted strings.
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];

    // Quoted string literal — copy verbatim until the closing quote
    if (ch === '"') {
      const end = expr.indexOf('"', i + 1);
      if (end === -1) {
        out += expr.slice(i);
        break;
      }
      out += expr.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Potential identifier start
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      const ident = expr.slice(i, j);
      const nextNonSpace = expr.slice(j).match(/^\s*(.)/)?.[1];

      // Skip function names — they're followed by "("
      if (nextNonSpace === '(' && FORMULA_FUNCTIONS.has(ident.toUpperCase())) {
        out += ident;
        i = j;
        continue;
      }

      // Skip keywords that parseExpression handles directly
      if (ident === 'TRUE' || ident === 'FALSE') {
        out += ident;
        i = j;
        continue;
      }

      // Look up in values. If found and numeric/bool, substitute literally;
      // if string, wrap in quotes. If not found, leave the identifier as-is
      // (which will fall through to parseArithmetic and either fail gracefully
      // or return the string).
      if (Object.prototype.hasOwnProperty.call(values, ident)) {
        const v = values[ident];
        if (v === null || v === undefined || v === '') {
          out += '""';
        } else if (typeof v === 'string') {
          // If the string is a number, substitute as number (allows stored "123" to math)
          const asNum = Number(v);
          out += !Number.isNaN(asNum) && v.trim() !== '' ? String(asNum) : `"${v}"`;
        } else {
          out += String(v);
        }
      } else {
        out += ident;
      }
      i = j;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/** Replace {fieldId} and {appendix_x.fieldId} with actual values */
function resolveReferences(
  expr: string,
  values: FormValues,
  crossRefValues?: Record<string, FormValues>
): string {
  return expr.replace(/\{([^}]+)\}/g, (_, ref: string) => {
    if (ref.includes('.')) {
      const [appendix, field] = ref.split('.', 2);
      const crossVals = crossRefValues?.[appendix];
      if (crossVals && crossVals[field] !== undefined && crossVals[field] !== null) {
        const v = crossVals[field];
        return typeof v === 'string' ? `"${v}"` : String(v);
      }
      return '""';
    }
    const val = values[ref];
    if (val === undefined || val === null) return '""';
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  });
}

/** Simple recursive descent parser */
function parseExpression(expr: string): string | number | boolean | null {
  expr = expr.trim();

  // IF function
  if (expr.toUpperCase().startsWith('IF(')) {
    return parseIF(expr);
  }

  // SUM function
  if (expr.toUpperCase().startsWith('SUM(')) {
    return parseSUM(expr);
  }

  // ROUND function
  if (expr.toUpperCase().startsWith('ROUND(')) {
    return parseROUND(expr);
  }

  // OR function
  if (expr.toUpperCase().startsWith('OR(')) {
    return parseOR(expr);
  }

  // AVG / AVERAGE — mean of numeric args (blank args ignored so an
  // unanswered question doesn't drag the average towards zero).
  if (expr.toUpperCase().startsWith('AVG(') || expr.toUpperCase().startsWith('AVERAGE(')) {
    return parseAverage(expr);
  }

  // MIN / MAX — smallest / largest numeric arg.
  if (expr.toUpperCase().startsWith('MIN(')) return parseMinMax(expr, 'MIN');
  if (expr.toUpperCase().startsWith('MAX(')) return parseMinMax(expr, 'MAX');

  // COUNT — number of non-blank / non-null args.
  if (expr.toUpperCase().startsWith('COUNT(')) return parseCount(expr);

  // ABS — absolute value. Handy for variance calcs.
  if (expr.toUpperCase().startsWith('ABS(')) return parseAbs(expr);

  // PERCENT(numerator, denominator [, decimals]) / PCT(...)
  // One-shot "num / den × 100" with zero-division returning 0 so you
  // don't get "Infinity" or "NaN" in a schedule field.
  if (expr.toUpperCase().startsWith('PERCENT(') || expr.toUpperCase().startsWith('PCT(')) {
    return parsePercent(expr);
  }

  // String literal
  if (expr.startsWith('"') && expr.endsWith('"')) {
    return expr.slice(1, -1);
  }

  // Number
  const num = Number(expr);
  if (!isNaN(num) && expr !== '') return num;

  // Boolean
  if (expr.toUpperCase() === 'TRUE') return true;
  if (expr.toUpperCase() === 'FALSE') return false;

  // Empty
  if (expr === '' || expr === '""') return '';

  // Try arithmetic
  return parseArithmetic(expr);
}

function parseIF(expr: string): string | number | boolean | null {
  // IF(condition, trueVal, falseVal)
  const inner = extractFunctionArgs(expr, 'IF');
  if (!inner || inner.length < 3) return null;

  const [condStr, trueStr, falseStr] = inner;
  const condResult = evaluateCondition(condStr.trim());
  return condResult
    ? parseExpression(trueStr.trim())
    : parseExpression(falseStr.trim());
}

function parseSUM(expr: string): number {
  const inner = extractFunctionArgs(expr, 'SUM');
  if (!inner) return 0;
  return inner.reduce((sum, arg) => {
    const val = parseExpression(arg.trim());
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);
}

function parseROUND(expr: string): number | null {
  const inner = extractFunctionArgs(expr, 'ROUND');
  if (!inner || inner.length < 2) return null;
  const val = parseExpression(inner[0].trim());
  const decimals = parseExpression(inner[1].trim());
  if (typeof val !== 'number' || typeof decimals !== 'number') return null;
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function parseOR(expr: string): boolean {
  const inner = extractFunctionArgs(expr, 'OR');
  if (!inner) return false;
  return inner.some(arg => {
    const val = parseExpression(arg.trim());
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val !== '' && val !== '0';
    return false;
  });
}

/** Numeric value collector — parses a list of function args and
 *  returns only the ones that evaluate to a finite number. Skips
 *  blanks and non-numerics so AVG/MIN/MAX behave sensibly on a
 *  partially-filled form. */
function numericArgs(inner: string[]): number[] {
  const out: number[] = [];
  for (const raw of inner) {
    const v = parseExpression(raw.trim());
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function parseAverage(expr: string): number | null {
  const name = expr.toUpperCase().startsWith('AVERAGE(') ? 'AVERAGE' : 'AVG';
  const inner = extractFunctionArgs(expr, name);
  if (!inner) return null;
  const nums = numericArgs(inner);
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function parseMinMax(expr: string, kind: 'MIN' | 'MAX'): number | null {
  const inner = extractFunctionArgs(expr, kind);
  if (!inner) return null;
  const nums = numericArgs(inner);
  if (nums.length === 0) return null;
  return kind === 'MIN' ? Math.min(...nums) : Math.max(...nums);
}

function parseCount(expr: string): number {
  const inner = extractFunctionArgs(expr, 'COUNT');
  if (!inner) return 0;
  // "Non-blank" rather than "numeric" — matches Excel COUNTA semantics,
  // which is what users usually mean when asking "how many answered?".
  let n = 0;
  for (const raw of inner) {
    const v = parseExpression(raw.trim());
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    n++;
  }
  return n;
}

function parseAbs(expr: string): number | null {
  const inner = extractFunctionArgs(expr, 'ABS');
  if (!inner || inner.length === 0) return null;
  const v = parseExpression(inner[0].trim());
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.abs(v);
}

/** PERCENT(num, den [, decimals])  →  (num / den) × 100
 *  Zero-division returns 0 (not NaN / Infinity) so blank denominators
 *  don't show as "Infinity%" in a schedule cell. Default 2 decimal
 *  places; pass a third arg to override. */
function parsePercent(expr: string): number | null {
  const name = expr.toUpperCase().startsWith('PERCENT(') ? 'PERCENT' : 'PCT';
  const inner = extractFunctionArgs(expr, name);
  if (!inner || inner.length < 2) return null;
  const num = parseExpression(inner[0].trim());
  const den = parseExpression(inner[1].trim());
  if (typeof num !== 'number' || typeof den !== 'number') return null;
  if (den === 0) return 0;
  const decimals = inner.length >= 3 ? Number(parseExpression(inner[2].trim())) : 2;
  const raw = (num / den) * 100;
  const factor = Math.pow(10, Number.isFinite(decimals) ? decimals : 2);
  return Math.round(raw * factor) / factor;
}

function evaluateCondition(condStr: string): boolean {
  // Handle comparison operators
  const operators = ['>=', '<=', '!=', '<>', '=', '>', '<'] as const;
  for (const op of operators) {
    const idx = condStr.indexOf(op);
    if (idx > 0) {
      const left = parseExpression(condStr.slice(0, idx).trim());
      const right = parseExpression(condStr.slice(idx + op.length).trim());

      // String comparison
      const l = left === null ? '' : left;
      const r = right === null ? '' : right;

      switch (op) {
        case '=': return l === r || String(l) === String(r);
        case '!=': case '<>': return l !== r && String(l) !== String(r);
        case '>': return Number(l) > Number(r);
        case '<': return Number(l) < Number(r);
        case '>=': return Number(l) >= Number(r);
        case '<=': return Number(l) <= Number(r);
      }
    }
  }

  // Truthy check
  const val = parseExpression(condStr);
  return !!val && val !== '' && val !== 0;
}

function parseArithmetic(expr: string): number | string | boolean | null {
  // Simple left-to-right arithmetic for +, -, *, /
  // Find the last + or - outside parentheses (lowest precedence)
  let depth = 0;
  let lastPlusMinusIdx = -1;
  let lastMulDivIdx = -1;

  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i];
    if (ch === ')') depth++;
    else if (ch === '(') depth--;
    else if (depth === 0) {
      if ((ch === '+' || ch === '-') && i > 0 && lastPlusMinusIdx === -1) {
        lastPlusMinusIdx = i;
      } else if ((ch === '*' || ch === '/') && lastMulDivIdx === -1) {
        lastMulDivIdx = i;
      }
    }
  }

  if (lastPlusMinusIdx > 0) {
    const left = parseExpression(expr.slice(0, lastPlusMinusIdx));
    const right = parseExpression(expr.slice(lastPlusMinusIdx + 1));
    if (typeof left === 'number' && typeof right === 'number') {
      return expr[lastPlusMinusIdx] === '+' ? left + right : left - right;
    }
  }

  if (lastMulDivIdx > 0) {
    const left = parseExpression(expr.slice(0, lastMulDivIdx));
    const right = parseExpression(expr.slice(lastMulDivIdx + 1));
    if (typeof left === 'number' && typeof right === 'number') {
      if (expr[lastMulDivIdx] === '*') return left * right;
      if (right !== 0) return left / right;
      return null;
    }
  }

  // Parenthesized expression
  if (expr.startsWith('(') && expr.endsWith(')')) {
    return parseExpression(expr.slice(1, -1));
  }

  // Return as string if nothing else works
  return expr;
}

/** Extract comma-separated function arguments, respecting nested parens and quotes */
function extractFunctionArgs(expr: string, funcName: string): string[] | null {
  const start = expr.toUpperCase().indexOf(funcName.toUpperCase() + '(');
  if (start === -1) return null;

  const openParen = start + funcName.length;
  let depth = 0;
  let inQuote = false;
  const args: string[] = [];
  let current = '';

  for (let i = openParen; i < expr.length; i++) {
    const ch = expr[i];

    if (ch === '"' && (i === 0 || expr[i - 1] !== '\\')) {
      inQuote = !inQuote;
      current += ch;
      continue;
    }

    if (inQuote) {
      current += ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      if (depth === 1) continue; // skip the opening paren
      current += ch;
    } else if (ch === ')') {
      if (depth === 1) {
        args.push(current);
        return args;
      }
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 1) {
      args.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  return args.length > 0 ? args : null;
}

/**
 * Evaluate a materiality calculation formula.
 * percentage * INDEX(benchmarkAmounts, MATCH(selectedBenchmark, benchmarkNames))
 */
export function calculateMateriality(
  percentage: number,
  benchmarkAmounts: Record<string, number>,
  selectedBenchmark: string
): number | null {
  const amount = benchmarkAmounts[selectedBenchmark];
  if (amount === undefined || isNaN(percentage)) return null;
  return Math.round(percentage * amount);
}

/**
 * Calculate fee/hour from fee and hours values.
 * Returns null if hours is 0 or empty.
 */
export function calculateFeePerHour(fee: number | null, hours: number | null): number | null {
  if (!fee || !hours || hours === 0) return null;
  return Math.ceil(fee / hours); // =ROUNDUP(Fee/Hours, 0)
}
