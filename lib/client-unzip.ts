/**
 * Client-side helper: expand any .zip files in an upload list so the downstream
 * upload handler sees each archive member as if it had been selected individually.
 *
 * Usage
 *   import { expandZipFiles } from '@/lib/client-unzip';
 *   const flat = await expandZipFiles(Array.from(fileInputRef.current.files));
 *   for (const f of flat) formData.append('files', f);
 *
 * Designed to work with any upload widget — wrap the raw FileList in
 * expandZipFiles() before handing the result to FormData. Non-zip files pass
 * through untouched. Zip files are opened with jszip, each contained file is
 * converted back into a File object (with the original filename), and a flat
 * list is returned.
 *
 * Nested zips: files inside zip files that are themselves zips are NOT
 * recursively expanded (one-level only) — recursive expansion is very rarely
 * wanted and risks exhausting memory on adversarial inputs.
 *
 * Empty directories and macOS __MACOSX metadata entries are skipped.
 */

import JSZip from 'jszip';

const ZIP_EXT = /\.zip$/i;
const SKIP_PATTERNS = [
  /^__MACOSX\//,     // macOS resource forks
  /\/\.DS_Store$/,   // macOS finder metadata
  /^\.DS_Store$/,
  /\/Thumbs\.db$/i,  // Windows thumbnail cache
];

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some(p => p.test(path));
}

function guessMimeType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'application/octet-stream';
}

/**
 * Single-file convenience wrapper around expandZipFiles, for upload widgets
 * that only accept one file at a time. If the user drops a zip, extract and
 * return the FIRST usable (non-metadata, non-nested-zip) file inside. If the
 * zip contains multiple files, the rest are ignored — a warning is logged so
 * devs can surface a notice if they want. If the zip is empty or invalid,
 * the original file is returned so the server-side handler can report the
 * error. Pass-through for non-zip files.
 *
 * Usage
 *   const file = await expandZipFile(e.target.files?.[0]);
 *   if (!file) return;
 *   // ... proceed as if the user had picked `file` directly
 */
export async function expandZipFile(input: File | null | undefined): Promise<File | null> {
  if (!input) return null;
  const flat = await expandZipFiles([input]);
  if (flat.length === 0) return input; // empty zip → pass through so server errors with a clear message
  if (flat.length > 1) {
    console.warn(`[expandZipFile] ${input.name} contained ${flat.length} files; using the first ("${flat[0].name}") and ignoring the rest.`);
  }
  return flat[0];
}

/**
 * Expand .zip files from a list of File objects. Non-zip files are returned
 * unchanged; .zip files are opened and each contained file becomes its own
 * File object with the same name (basename) and a best-effort mime type.
 */
export async function expandZipFiles(input: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of input) {
    if (!ZIP_EXT.test(file.name) && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      out.push(file);
      continue;
    }
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files);
      for (const entry of entries) {
        if (entry.dir) continue;
        if (shouldSkip(entry.name)) continue;
        // Skip nested zips — user shouldn't need recursive expansion here
        if (ZIP_EXT.test(entry.name)) continue;
        const blob = await entry.async('blob');
        // Use the basename (strip any folder path inside the zip) so downstream
        // consumers see clean filenames, matching what they'd get if the user
        // had uploaded each file directly.
        const basename = entry.name.split(/[\\/]/).pop() || entry.name;
        const mime = guessMimeType(basename);
        out.push(new File([blob], basename, { type: mime, lastModified: entry.date?.getTime() || Date.now() }));
      }
    } catch (err) {
      // If we can't open the zip, pass the raw file through and let the
      // downstream handler deal with it (will probably error with a clear
      // message). Log for debugging but don't break the upload.
      console.warn(`[expandZipFiles] Failed to expand ${file.name}:`, err);
      out.push(file);
    }
  }
  return out;
}
