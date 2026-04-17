// One-off helper: read .env.prod, strip literal trailing "\n" sequences
// from DATABASE_URL / DIRECT_URL values, and print a clean dotenv-style
// file so we can `dotenv -e` the output into `prisma migrate deploy`.
//
// This file is transient and gets removed by the runner script after use.
const fs = require('fs');
const content = fs.readFileSync('.env.prod', 'utf8');
const lines = content.split(/\r?\n/);
const out = [];
for (const l of lines) {
  const m = l.match(/^([A-Z_]+)="(.*)"$/);
  if (!m) continue;
  if (m[1] !== 'DATABASE_URL' && m[1] !== 'DIRECT_URL') continue;
  let value = m[2];
  // Strip any trailing literal \n (backslash + n) that shell/editors
  // sometimes leave behind when copy-pasting URLs.
  while (value.endsWith('\\n')) value = value.slice(0, -2);
  // Also strip actual trailing newline/whitespace just in case.
  value = value.trimEnd();
  out.push(`${m[1]}=${value}`);
}
fs.writeFileSync('.env.prisma-deploy', out.join('\n') + '\n');
console.log('Wrote .env.prisma-deploy with', out.length, 'vars.');
