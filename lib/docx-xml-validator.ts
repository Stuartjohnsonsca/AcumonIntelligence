/**
 * Post-emission OOXML integrity checks for body XML produced by
 * `template-html-to-docx`.
 *
 * Word's validator is strict — a single empty <w:tc>, missing <w:tblGrid>,
 * or unbalanced tag triggers the "We found a problem with some of the
 * content" repair dialog on every open, even when the document renders
 * fine otherwise. Users lose trust in the output fast.
 *
 * This module pairs with the converter's existing auto-repair passes:
 * the converter silently fixes known defects (empty text, orphan runs,
 * missing tblGrid, etc.), then this validator scans the post-repair
 * output for anything the repairer didn't catch. ANY issue reported
 * here = a new defect pattern we should teach the repairer about.
 *
 * Behaviour:
 *   - ALWAYS logs a warning (console.warn) listing every issue + a
 *     short snippet of the offending XML so the defect surfaces in
 *     Vercel logs for the admin to investigate.
 *   - In non-production NODE_ENV, throws so CI / local dev flags the
 *     regression immediately instead of silently shipping broken docx.
 *   - Optionally (via `strict: true`) throws in production too — caller
 *     decides whether user-visible generation should hard-fail.
 *
 * Designed to be cheap: one pass per rule, small regex scans, ~O(n)
 * in XML length. Safe to run on every generation.
 */

export type DocxValidationCode =
  | 'tc-no-para'       // <w:tc> missing required <w:p>
  | 'tbl-no-tr'        // <w:tbl> with zero rows
  | 'tbl-no-grid'      // <w:tbl> missing required <w:tblGrid>
  | 'empty-t'          // <w:t></w:t> — fires Word repair
  | 'empty-r'          // <w:r></w:r> — fires Word repair
  | 'tag-imbalance'    // open/close counts don't match for a major element
  | 'orphan-close';    // </w:something> with no prior open

export interface DocxValidationIssue {
  code: DocxValidationCode;
  message: string;
  /** 1-based occurrence index for this code across the document. */
  occurrence: number;
  /** Short snippet (≤ ~140 chars) around the offending fragment. */
  context?: string;
}

/**
 * Run every integrity check on a body-fragment XML string. Returns the
 * complete list of issues found. Empty array = clean.
 *
 * Order matters: tag-imbalance first (a broken structure would produce
 * noisy false positives downstream); then structural requirements
 * (cells, tables); then the "easy" empty-element checks.
 */
export function validateDocxBodyXml(xml: string): DocxValidationIssue[] {
  const issues: DocxValidationIssue[] = [];
  const add = (code: DocxValidationCode, message: string, context?: string) => {
    const occurrence = issues.filter(i => i.code === code).length + 1;
    issues.push({ code, message, occurrence, context });
  };

  // ── 1. Tag balance ──────────────────────────────────────────────────
  // Count PAIRED opens (those requiring a matching </name>) vs their
  // closes. Self-closes like <w:p/> or <w:tblGrid attr/> don't need a
  // close tag and are excluded from both sides of the comparison.
  //
  // Implementation note: match every `<name...>` occurrence, then
  // classify by whether its last non-space char before `>` is `/`
  // (self-close) or not (paired). This avoids the regex pitfalls of
  // trying to distinguish `<w:p>` from `<w:p/>` with lookbehind.
  const containers = ['w:p', 'w:r', 'w:tbl', 'w:tr', 'w:tc', 'w:rPr', 'w:pPr', 'w:tcPr', 'w:tblPr', 'w:trPr', 'w:tblGrid'];
  for (const name of containers) {
    const tagRe = new RegExp(`<${name}\\b[^>]*>`, 'g');
    const closeRe = new RegExp(`</${name}>`, 'g');
    const allTags = xml.match(tagRe) || [];
    let paired = 0;
    for (const t of allTags) {
      // Self-close ends with `/>` (possibly with whitespace before the /).
      // Paired open ends with `>` without a preceding /.
      const before = t.slice(0, -1).trimEnd();
      const isSelfClose = before.endsWith('/');
      if (!isSelfClose) paired++;
    }
    const closes = (xml.match(closeRe) || []).length;
    const unmatched = paired - closes;
    if (unmatched !== 0) {
      add(
        'tag-imbalance',
        `<${name}> paired open/close mismatch: ${paired} paired opens vs ${closes} closes (diff ${unmatched > 0 ? '+' : ''}${unmatched})`,
      );
    }
  }

  // ── 2. <w:tc> must contain at least one <w:p> ──────────────────────
  const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRe.exec(xml)) !== null) {
    const inner = cellMatch[1];
    if (!/<w:p\b/.test(inner)) {
      add(
        'tc-no-para',
        'Table cell has no <w:p> — OOXML requires every <w:tc> to contain at least one paragraph',
        snippet(xml, cellMatch.index, cellMatch[0].length),
      );
    }
  }

  // ── 3. <w:tbl> must contain at least one <w:tr> AND a <w:tblGrid> ───
  const tblRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  let tblMatch: RegExpExecArray | null;
  while ((tblMatch = tblRe.exec(xml)) !== null) {
    const inner = tblMatch[1];
    if (!/<w:tr\b/.test(inner)) {
      add(
        'tbl-no-tr',
        'Table has no <w:tr> — OOXML requires every table to have at least one row',
        snippet(xml, tblMatch.index, tblMatch[0].length),
      );
    }
    if (!/<w:tblGrid\b/.test(inner)) {
      add(
        'tbl-no-grid',
        'Table has no <w:tblGrid> — OOXML requires a grid declaring column widths',
        snippet(xml, tblMatch.index, tblMatch[0].length),
      );
    }
  }

  // ── 4. Empty text and empty runs ────────────────────────────────────
  // Word flags <w:t></w:t> / <w:r></w:r> as unreadable content even though
  // the OOXML XSD technically accepts them. The converter strips these in
  // post-processing; anything surviving to here is a leak.
  const emptyTRe = /<w:t\b[^>]*>\s*<\/w:t>/g;
  let emptyTMatch: RegExpExecArray | null;
  while ((emptyTMatch = emptyTRe.exec(xml)) !== null) {
    add('empty-t', 'Empty <w:t></w:t> — Word flags these as unreadable', snippet(xml, emptyTMatch.index, emptyTMatch[0].length));
  }
  const emptyRRe = /<w:r\b[^>]*>\s*<\/w:r>/g;
  let emptyRMatch: RegExpExecArray | null;
  while ((emptyRMatch = emptyRRe.exec(xml)) !== null) {
    add('empty-r', 'Empty <w:r></w:r> — Word flags these as unreadable', snippet(xml, emptyRMatch.index, emptyRMatch[0].length));
  }

  return issues;
}

/**
 * Convenience wrapper that runs validation, logs any issues, and
 * optionally throws. Most callers want this rather than calling
 * `validateDocxBodyXml` directly.
 *
 *   - In production with no issues: silent.
 *   - In production WITH issues: console.warn so the defects surface
 *     in Vercel logs but generation still succeeds (user stays
 *     unblocked — worst case they see Word's repair dialog, which is
 *     no worse than before the validator existed).
 *   - In non-production: throws on any issue so CI / local dev catches
 *     regressions immediately. Override with `strict: false` to match
 *     production behaviour (used by unit tests that deliberately feed
 *     bad XML).
 *   - Caller can force strict mode in production via `strict: true` —
 *     useful if the render endpoint wants to fail the request rather
 *     than ship a broken docx.
 *
 * The `source` label identifies the caller in log output so you can
 * tell "issues found in planning-letter generation" from "issues in
 * engagement-letter generation" at a glance.
 */
export function validateAndLogDocxBodyXml(
  xml: string,
  source: string,
  opts: { strict?: boolean } = {},
): DocxValidationIssue[] {
  const issues = validateDocxBodyXml(xml);
  if (issues.length === 0) return issues;

  const isProd = process.env.NODE_ENV === 'production';
  const strict = opts.strict ?? !isProd;

  // Log a readable summary. Console.warn rather than console.error
  // because generation still produces output (the defects cause Word's
  // repair dialog, not a hard crash).
  // eslint-disable-next-line no-console
  console.warn(
    `[docx-validator] ${source}: ${issues.length} OOXML issue(s) found post-repair — please investigate:`,
  );
  for (const issue of issues) {
    // eslint-disable-next-line no-console
    console.warn(
      `  [${issue.code}#${issue.occurrence}] ${issue.message}` +
      (issue.context ? `\n    context: ${issue.context}` : ''),
    );
  }

  if (strict) {
    const summary = issues.map(i => `${i.code}(${i.occurrence})`).slice(0, 5).join(', ');
    throw new Error(
      `OOXML validation failed for ${source}: ${issues.length} issue(s) — ${summary}${issues.length > 5 ? ', …' : ''}. ` +
      `This would trigger Word's 'We found a problem' dialog. See server logs for details.`,
    );
  }

  return issues;
}

/** Extract a short snippet of XML around an offset for use in logs.
 *  Trimmed and truncated so the log line stays readable. */
function snippet(xml: string, offset: number, length: number): string {
  const maxLen = 140;
  const actual = length > maxLen ? `${xml.slice(offset, offset + maxLen - 3)}...` : xml.slice(offset, offset + length);
  // Collapse runs of whitespace to keep the log line compact.
  return actual.replace(/\s+/g, ' ').trim();
}
