import fs from 'fs';
import type { RunResult } from '../types';

/**
 * Export the full run result as a pretty-printed JSON file.
 */
export function exportResultJson(
  runResult: RunResult,
  outputPath: string
): void {
  const json = JSON.stringify(runResult, null, 2);
  fs.writeFileSync(outputPath, json, 'utf-8');
}
