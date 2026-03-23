import { assignKeyToJob, getJobKeyIndex, incrementJobCounter, isKeyCoolingDown, setKeyCooldown } from './redis';

/**
 * AI Key Manager — manages multiple API keys for Together AI.
 *
 * Rules:
 * - Same key is used for an entire job (consistency — same model behaviour)
 * - Keys are round-robin assigned to new jobs
 * - If a key hits rate limit, it enters cooldown and new jobs skip it
 * - Existing jobs wait for their assigned key to recover
 */

export interface KeyConfig {
  keys: string[];
  source: string; // env var name for logging
}

/**
 * Parse comma-separated API keys from an environment variable.
 * Falls back to single key if no commas found.
 */
export function parseKeys(envVarName: string): KeyConfig {
  const raw = process.env[envVarName] || '';
  const keys = raw.split(',').map(k => k.trim()).filter(k => k.length > 0);

  if (keys.length === 0) {
    throw new Error(`No API keys found in ${envVarName}`);
  }

  console.log(`[KeyManager] Loaded ${keys.length} key(s) from ${envVarName}`);
  return { keys, source: envVarName };
}

/**
 * Get the API key assigned to a job. If no key is assigned yet, assign one
 * using round-robin across available (non-cooldown) keys.
 */
export async function getKeyForJob(jobId: string, config: KeyConfig): Promise<string> {
  // Check if this job already has an assigned key
  const existingIdx = await getJobKeyIndex(jobId);
  if (existingIdx !== null && existingIdx < config.keys.length) {
    return config.keys[existingIdx];
  }

  // Find the next available key (skip keys in cooldown)
  const counter = await incrementJobCounter();
  const numKeys = config.keys.length;

  for (let attempt = 0; attempt < numKeys; attempt++) {
    const idx = (counter + attempt) % numKeys;
    const cooling = await isKeyCoolingDown(idx);
    if (!cooling) {
      await assignKeyToJob(jobId, idx);
      console.log(`[KeyManager] Assigned key ${idx}/${numKeys} to job ${jobId}`);
      return config.keys[idx];
    }
  }

  // All keys are in cooldown — use the round-robin one anyway (it'll retry later)
  const fallbackIdx = counter % numKeys;
  await assignKeyToJob(jobId, fallbackIdx);
  console.warn(`[KeyManager] All keys cooling down, assigning key ${fallbackIdx} to job ${jobId} (will retry)`);
  return config.keys[fallbackIdx];
}

/**
 * Mark a key as rate-limited. The key enters cooldown for the specified duration.
 */
export async function markKeyRateLimited(jobId: string, config: KeyConfig, cooldownSeconds = 60): Promise<void> {
  const idx = await getJobKeyIndex(jobId);
  if (idx !== null) {
    await setKeyCooldown(idx, cooldownSeconds);
    console.warn(`[KeyManager] Key ${idx}/${config.keys.length} rate-limited for ${cooldownSeconds}s`);
  }
}

/**
 * Get key config for document summary.
 * Supports: TOGETHER_DOC_SUMMARY_KEYS (comma-separated) or TOGETHER_DOC_SUMMARY_KEY (single)
 */
export function getDocSummaryKeyConfig(): KeyConfig {
  // Try multi-key first
  const multiKey = process.env.TOGETHER_DOC_SUMMARY_KEYS;
  if (multiKey && multiKey.includes(',')) {
    return parseKeys('TOGETHER_DOC_SUMMARY_KEYS');
  }

  // Fall back to single key
  return parseKeys('TOGETHER_DOC_SUMMARY_KEY');
}

/**
 * Get key config for data extraction.
 */
export function getExtractionKeyConfig(): KeyConfig {
  const multiKey = process.env.TOGETHER_API_KEYS;
  if (multiKey && multiKey.includes(',')) {
    return parseKeys('TOGETHER_API_KEYS');
  }

  return parseKeys('TOGETHER_API_KEY');
}
