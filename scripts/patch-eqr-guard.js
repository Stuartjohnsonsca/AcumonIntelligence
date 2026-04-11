// One-shot script to inject the EQR write-access guard into every write handler
// under app/api/engagements/[engagementId]/**. Idempotent — skips files already patched.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'app', 'api', 'engagements', '[engagementId]');

const FILES = [
  'agreed-dates/route.ts',
  'ai-classify-tb/route.ts',
  'analytical-review/route.ts',
  // audit-points handled separately (allowEQR + review_point restriction)
  'board-minutes/route.ts',
  'contacts/route.ts',
  'continuance/route.ts',
  'documents/route.ts',
  'error-schedule/route.ts',
  'ethics/route.ts',
  'extraction-session/route.ts',
  'far/route.ts',
  'generate-document/route.ts',
  'info-requests/route.ts',
  'intelligence/route.ts',
  'journal-risk/route.ts',
  'journal-risk/entries/route.ts',
  'materiality-breach/route.ts',
  'materiality/route.ts',
  'meetings/route.ts',
  'new-client-takeon/route.ts',
  'new-client/route.ts',
  'outstanding/route.ts',
  'par/route.ts',
  'par/send-management/route.ts',
  'par/send-rmm/route.ts',
  'payroll-test/route.ts',
  'permanent-file/route.ts',
  'prior-period/route.ts',
  'rmm/ai-summary/route.ts',
  'rmm/populate/route.ts',
  'rmm/route.ts',
  'route.ts', // base engagement route
  'significant-risk/route.ts',
  'srmm/route.ts',
  'subsequent-events/route.ts',
  'tax-technical/route.ts',
  'team/route.ts',
  'test-allocations/route.ts',
  'test-conclusions/route.ts',
  'test-execution/[executionId]/route.ts',
  'test-execution/route.ts',
  'trial-balance/import-accounting/route.ts',
  'trial-balance/route.ts',
  'walkthrough-flowchart/route.ts',
  'walkthrough-request/route.ts',
  'fs-hierarchy/route.ts',
];

const IMPORT_LINE = `import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';`;
const GUARD_SNIPPET = `
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;`;

function patchFile(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    console.log(`SKIP ${relPath} — not found`);
    return { status: 'notfound' };
  }
  let src = fs.readFileSync(full, 'utf8');

  if (src.includes('assertEngagementWriteAccess')) {
    return { status: 'already' };
  }

  // Add import after existing NextResponse import (most reliable anchor)
  const nextResponseImport = src.match(/^import .*NextResponse.*;$/m);
  if (!nextResponseImport) {
    console.log(`SKIP ${relPath} — no NextResponse import found`);
    return { status: 'noimport' };
  }
  const imp = nextResponseImport[0];
  src = src.replace(imp, `${imp}\n${IMPORT_LINE}`);

  // Find every write handler and inject the guard after the verifyAccess / verifyEngagementAccess line
  // Pattern: find `export async function (POST|PUT|PATCH|DELETE)` ... up to next `export async function` or end
  // Inside that range, find the line that contains `verifyAccess` or `verifyEngagementAccess`
  // and insert the guard right after it.

  const methodRegex = /export async function (POST|PUT|PATCH|DELETE)\s*\([^)]*\)\s*\{/g;
  const matches = [];
  let m;
  while ((m = methodRegex.exec(src)) !== null) {
    matches.push({ index: m.index, method: m[1], headerEnd: m.index + m[0].length });
  }

  if (matches.length === 0) {
    return { status: 'noWriteHandler' };
  }

  // Process in reverse so indexes don't shift
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    // Find the end of this handler: next export async function or end of file
    const nextMatch = matches[i + 1];
    const endOfHandler = nextMatch ? nextMatch.index : src.length;
    const handlerBody = src.slice(match.headerEnd, endOfHandler);

    // Look for the verifyAccess line (various patterns)
    // Priority: line that contains verifyAccess OR verifyEngagementAccess and ends with `);`
    const bodyLines = handlerBody.split('\n');
    let insertAfterLineIdx = -1;
    for (let j = 0; j < bodyLines.length; j++) {
      const line = bodyLines[j];
      if (/verifyAccess\s*\(|verifyEngagementAccess\s*\(/.test(line)) {
        // Find the line that closes this statement (may be same line or next)
        if (line.includes(';')) {
          insertAfterLineIdx = j;
          break;
        } else {
          // multi-line statement — find the closing
          for (let k = j + 1; k < bodyLines.length; k++) {
            if (bodyLines[k].includes(';')) {
              insertAfterLineIdx = k;
              break;
            }
          }
          break;
        }
      }
    }

    // Fallback: find the engagementId extraction line
    if (insertAfterLineIdx === -1) {
      for (let j = 0; j < bodyLines.length; j++) {
        if (/const\s*\{\s*engagementId\s*\}\s*=\s*await\s+params/.test(bodyLines[j])) {
          insertAfterLineIdx = j;
          break;
        }
      }
    }

    // If still nothing, skip this handler (will need manual review)
    if (insertAfterLineIdx === -1) {
      console.log(`WARN ${relPath} ${match.method} — no anchor line; skipped this handler`);
      continue;
    }

    // Insert the guard snippet after the insertion line
    bodyLines[insertAfterLineIdx] = bodyLines[insertAfterLineIdx] + GUARD_SNIPPET;
    const newBody = bodyLines.join('\n');
    src = src.slice(0, match.headerEnd) + newBody + src.slice(endOfHandler);
  }

  fs.writeFileSync(full, src);
  return { status: 'patched', handlers: matches.length };
}

let summary = { patched: 0, already: 0, notfound: 0, other: 0 };
for (const f of FILES) {
  const r = patchFile(f);
  console.log(`${r.status.padEnd(10)} ${f}`);
  if (r.status === 'patched') summary.patched++;
  else if (r.status === 'already') summary.already++;
  else if (r.status === 'notfound') summary.notfound++;
  else summary.other++;
}
console.log('\nSUMMARY', summary);
