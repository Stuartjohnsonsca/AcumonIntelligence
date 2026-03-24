/**
 * Safe client-side formula engine for audit appendix computed fields.
 * Supports: IF, SUM, ROUND, INDEX/MATCH, basic arithmetic, cell refs.
 * No eval() - uses a recursive descent parser.
 */

type FormValues = Record<string, string | number | boolean | null>;

export function evaluateFormula(
  expression: string,
  values: FormValues,
  crossRefValues?: Record<string, FormValues>
): string | number | boolean | null {
  if (!expression) return null;

  try {
    const resolved = resolveReferences(expression, values, crossRefValues);
    return parseExpression(resolved.trim());
  } catch {
    return null; // Gracefully return null on any parse error
  }
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

function parseArithmetic(expr: string): number | string | null {
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
  return Math.round((fee / hours) * 100) / 100;
}
