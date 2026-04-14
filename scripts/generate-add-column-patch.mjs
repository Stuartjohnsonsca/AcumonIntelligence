#!/usr/bin/env node
// Reads prisma/schema.prisma and outputs SQL with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
// for every scalar column declared in every model. Safe to run repeatedly — IF NOT EXISTS makes
// it idempotent and no existing rows are touched.
//
// Usage: node scripts/generate-add-column-patch.mjs > patch.sql
//
// Limitations:
//  - Skips relation fields (virtual, have no DB column)
//  - Non-nullable fields with no @default are emitted as NULLABLE (the schema says NOT NULL but
//    we cannot back-fill arbitrary data; add the default by hand if the column matters).
//  - Enum types are emitted as TEXT (Prisma stores enums as text under the hood unless you use
//    @db.PgEnum).
//  - Indexes / FKs / unique constraints are NOT emitted — only columns. Add @@unique / @@index
//    constraints separately if the live DB lacks them.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '..', 'prisma', 'schema.prisma');
const src = readFileSync(schemaPath, 'utf8');

// ─── Collect model names & enum names so we can identify relation fields ───
const modelNames = new Set();
const enumNames = new Set();
for (const m of src.matchAll(/^model\s+(\w+)\s*\{/gm)) modelNames.add(m[1]);
for (const m of src.matchAll(/^enum\s+(\w+)\s*\{/gm)) enumNames.add(m[1]);

function snake(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function pgType(prismaType, modifiers) {
  // @db.* overrides
  const dbType = modifiers.match(/@db\.(\w+)(?:\(([^)]*)\))?/);
  if (dbType) {
    const t = dbType[1];
    const arg = dbType[2];
    switch (t) {
      case 'Text':       return 'TEXT';
      case 'VarChar':    return arg ? `VARCHAR(${arg})` : 'VARCHAR';
      case 'Char':       return arg ? `CHAR(${arg})`    : 'CHAR';
      case 'Boolean':    return 'BOOLEAN';
      case 'Integer':    return 'INTEGER';
      case 'SmallInt':   return 'SMALLINT';
      case 'BigInt':     return 'BIGINT';
      case 'Real':       return 'REAL';
      case 'DoublePrecision': return 'DOUBLE PRECISION';
      case 'Decimal':    return arg ? `DECIMAL(${arg})` : 'DECIMAL(65,30)';
      case 'Timestamp':  return arg ? `TIMESTAMP(${arg})` : 'TIMESTAMP(3)';
      case 'Timestamptz':return arg ? `TIMESTAMPTZ(${arg})` : 'TIMESTAMPTZ(3)';
      case 'Date':       return 'DATE';
      case 'Time':       return arg ? `TIME(${arg})` : 'TIME';
      case 'Json':       return 'JSONB';
      case 'JsonB':      return 'JSONB';
      case 'Uuid':       return 'UUID';
      case 'Bytes':      return 'BYTEA';
      case 'ByteA':      return 'BYTEA';
      default: return t.toUpperCase();
    }
  }
  switch (prismaType) {
    case 'String':   return 'TEXT';
    case 'Int':      return 'INTEGER';
    case 'BigInt':   return 'BIGINT';
    case 'Float':    return 'DOUBLE PRECISION';
    case 'Decimal':  return 'DECIMAL(65,30)';
    case 'Boolean':  return 'BOOLEAN';
    case 'DateTime': return 'TIMESTAMP(3)';
    case 'Json':     return 'JSONB';
    case 'Bytes':    return 'BYTEA';
    default:
      // enum or unknown — store as TEXT
      return 'TEXT';
  }
}

function pgDefault(modifiers, prismaType) {
  const def = modifiers.match(/@default\(([^)]*)\)/);
  if (!def) return null;
  const v = def[1].trim();
  if (v === 'now()')           return 'CURRENT_TIMESTAMP';
  if (v === 'true' || v === 'false') return v;
  if (v === 'uuid()' || v === 'cuid()') return null; // Prisma generates client-side
  if (v === 'autoincrement()') return null;          // sequence — handle manually
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;           // numeric literal
  if (v.startsWith('"') && v.endsWith('"')) {
    const s = v.slice(1, -1).replace(/'/g, "''");
    return `'${s}'`;
  }
  // dbgenerated / function call — skip
  return null;
}

const out = [];
const modelBlockRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
for (const block of src.matchAll(modelBlockRe)) {
  const modelName = block[1];
  const body = block[2];
  // Find @@map("table_name")
  const mapMatch = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
  const tableName = mapMatch ? mapMatch[1] : snake(modelName);

  // Emit CREATE TABLE IF NOT EXISTS first so missing-table errors don't kill the patch.
  // Empty stub — columns are added via ALTER TABLE below. If the table already exists
  // with its real PK, this is a no-op; if it doesn't, it gets created and the columns
  // (including any PK column) are added next.
  out.push(`CREATE TABLE IF NOT EXISTS "${tableName}" ();`);

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('@@')) continue;
    // Field line: name type[? or [] ] modifiers...
    const fieldRe = /^(\w+)\s+(\w+)(\?|\[\])?\s*(.*)$/;
    const m = trimmed.match(fieldRe);
    if (!m) continue;
    const [, fieldName, baseType, suffix, modifiers] = m;
    if (suffix === '[]') continue;                          // list — relation, no col
    if (modifiers && modifiers.includes('@relation('))      continue;
    if (modelNames.has(baseType) && !enumNames.has(baseType)) continue; // single relation
    const colName = (modifiers.match(/@map\(\s*"([^"]+)"\s*\)/) || [, snake(fieldName)])[1];
    const colType = pgType(baseType, modifiers);
    const nullable = suffix === '?';
    const def = pgDefault(modifiers, baseType);
    let stmt = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${colType}`;
    if (!nullable && def !== null) stmt += ` NOT NULL DEFAULT ${def}`;
    else if (def !== null)         stmt += ` DEFAULT ${def}`;
    // (otherwise leave nullable; existing rows get NULL)
    stmt += ';';
    out.push(stmt);
  }
}

// Header
console.log('-- Auto-generated by scripts/generate-add-column-patch.mjs');
console.log('-- Adds every column declared in prisma/schema.prisma if missing.');
console.log('-- Idempotent. Safe to run multiple times.');
console.log('');
console.log(out.join('\n'));
