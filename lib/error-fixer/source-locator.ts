import { promises as fs } from 'fs';
import path from 'path';

const REPO_ROOT = process.cwd();
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 50_000;

export interface SourceFile {
  path: string;        // repo-relative
  contents: string;
}

/**
 * Heuristically guess the source files relevant to a URL so Claude has context
 * to propose a fix. Best-effort — returns whatever exists, capped to avoid
 * blowing the prompt budget.
 *
 * Strategy:
 *   /api/foo/bar          → app/api/foo/bar/route.ts
 *   /api/foo/[id]         → app/api/foo/[id]/route.ts
 *   /methodology-admin/x  → app/methodology-admin/x/page.tsx
 *   /                     → app/page.tsx
 */
export async function findRelevantFiles(rawUrl: string | null | undefined): Promise<SourceFile[]> {
  if (!rawUrl) return [];

  let pathname: string;
  try {
    // Accept absolute or relative URLs
    pathname = rawUrl.startsWith('http') ? new URL(rawUrl).pathname : rawUrl.split('?')[0];
  } catch {
    return [];
  }

  // Strip leading/trailing slashes; treat '' as root
  const segments = pathname.split('/').filter(Boolean);

  const candidates: string[] = [];

  if (segments[0] === 'api') {
    // app/api/<...>/route.ts
    candidates.push(path.join('app', ...segments, 'route.ts'));
    candidates.push(path.join('app', ...segments, 'route.tsx'));
  } else {
    // app/<...>/page.tsx
    if (segments.length === 0) {
      candidates.push(path.join('app', 'page.tsx'));
    } else {
      candidates.push(path.join('app', ...segments, 'page.tsx'));
      candidates.push(path.join('app', ...segments, 'page.ts'));
      // Try parents in case it's a sub-route under a layout
      for (let i = segments.length - 1; i > 0; i--) {
        candidates.push(path.join('app', ...segments.slice(0, i), 'page.tsx'));
      }
      // If looks like a dynamic segment, also try [id] variant at last position
      if (!segments[segments.length - 1].startsWith('[')) {
        candidates.push(path.join('app', ...segments.slice(0, -1), '[id]', 'page.tsx'));
      }
    }
  }

  const seen = new Set<string>();
  const found: SourceFile[] = [];
  let totalBytes = 0;

  for (const rel of candidates) {
    if (seen.has(rel) || found.length >= MAX_FILES) continue;
    seen.add(rel);
    try {
      const abs = path.join(REPO_ROOT, rel);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) continue;
      const buf = await fs.readFile(abs, 'utf8');
      const slice = buf.length + totalBytes > MAX_TOTAL_BYTES ? buf.slice(0, Math.max(0, MAX_TOTAL_BYTES - totalBytes)) : buf;
      if (!slice) break;
      totalBytes += slice.length;
      found.push({ path: rel.replaceAll('\\', '/'), contents: slice });
    } catch {
      // file doesn't exist, try next candidate
    }
  }

  // Try to also pull in obvious imports of client components from the page.
  // Cheap regex — good enough to grab one or two related files.
  const additional: string[] = [];
  for (const f of found) {
    const importRe = /from ['"]@\/(components|lib)\/([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(f.contents)) !== null && additional.length < 5) {
      additional.push(`${m[1]}/${m[2]}.tsx`);
      additional.push(`${m[1]}/${m[2]}.ts`);
    }
  }
  for (const rel of additional) {
    if (seen.has(rel) || found.length >= MAX_FILES) continue;
    seen.add(rel);
    try {
      const abs = path.join(REPO_ROOT, rel);
      const buf = await fs.readFile(abs, 'utf8');
      const slice = buf.length + totalBytes > MAX_TOTAL_BYTES ? buf.slice(0, Math.max(0, MAX_TOTAL_BYTES - totalBytes)) : buf;
      if (!slice) break;
      totalBytes += slice.length;
      found.push({ path: rel.replaceAll('\\', '/'), contents: slice });
    } catch {
      // ignore
    }
  }

  return found;
}
