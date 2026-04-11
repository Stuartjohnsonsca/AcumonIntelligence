// Fix files where the EQR guard got inserted inside a multi-line if-block
// rather than after its closing brace.
const fs = require('fs');
const path = require('path');

const FILES = [
  'analytical-review/route.ts',
  'board-minutes/route.ts',
  'meetings/route.ts',
  'payroll-test/route.ts',
  'significant-risk/route.ts',
  'srmm/route.ts',
];

const ROOT = path.join(__dirname, '..', 'app', 'api', 'engagements', '[engagementId]');

function fix(relPath) {
  const full = path.join(ROOT, relPath);
  let src = fs.readFileSync(full, 'utf8');
  const lines = src.split('\n');
  const out = [];
  const pending = []; // guard lines waiting to be re-emitted after the closing }
  let awaitingCloseBrace = false;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.includes('const __eqrGuard = await assertEngagementWriteAccess')) {
      // Look ahead: if the next line is the `if (__eqrGuard instanceof NextResponse) return __eqrGuard;`
      // and the line after that is a closing brace `}`, we're inside an if-block.
      const nextLn = lines[i + 1] || '';
      const thirdLn = lines[i + 2] || '';
      if (/if \(__eqrGuard instanceof NextResponse\)/.test(nextLn) && /^\s*\}\s*$/.test(thirdLn)) {
        // Capture the guard lines and skip past them
        pending.push(ln, nextLn);
        awaitingCloseBrace = true;
        i += 1; // skip the next line too
        continue;
      }
    }
    out.push(ln);
    if (awaitingCloseBrace && /^\s*\}\s*$/.test(ln)) {
      // Emit the pending guard lines AFTER the closing brace
      for (const p of pending) out.push(p);
      pending.length = 0;
      awaitingCloseBrace = false;
    }
  }

  const newSrc = out.join('\n');
  if (newSrc !== src) {
    fs.writeFileSync(full, newSrc);
    console.log(`FIXED ${relPath}`);
  } else {
    console.log(`NOCHG ${relPath}`);
  }
}

for (const f of FILES) fix(f);
