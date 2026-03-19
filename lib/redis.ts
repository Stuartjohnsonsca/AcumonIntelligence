import Redis from 'ioredis';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL || process.env.AZURE_REDIS_CONNECTION_STRING;
    if (!url) {
      throw new Error('REDIS_URL or AZURE_REDIS_CONNECTION_STRING is not configured');
    }

    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      enableReadyCheck: true,
      tls: url.includes('redis.cache.windows.net') ? { rejectUnauthorized: false } : undefined,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }

  return redis;
}

// ─── Job Status ──────────────────────────────────────────────────────────────

export async function setJobStatus(jobId: string, status: string, ttlSeconds = 86400): Promise<void> {
  const r = getRedis();
  await r.set(`job:${jobId}:status`, status, 'EX', ttlSeconds);
}

export async function getJobStatus(jobId: string): Promise<string | null> {
  const r = getRedis();
  return r.get(`job:${jobId}:status`);
}

export async function setFileStatus(jobId: string, fileId: string, status: string): Promise<void> {
  const r = getRedis();
  await r.hset(`job:${jobId}:files`, fileId, status);
  await r.expire(`job:${jobId}:files`, 86400);
}

export async function getFileStatuses(jobId: string): Promise<Record<string, string>> {
  const r = getRedis();
  return r.hgetall(`job:${jobId}:files`);
}

// ─── AI Key Management ───────────────────────────────────────────────────────

export async function assignKeyToJob(jobId: string, keyIndex: number): Promise<void> {
  const r = getRedis();
  await r.set(`job:${jobId}:keyIdx`, String(keyIndex), 'EX', 86400);
}

export async function getJobKeyIndex(jobId: string): Promise<number | null> {
  const r = getRedis();
  const val = await r.get(`job:${jobId}:keyIdx`);
  return val !== null ? parseInt(val, 10) : null;
}

export async function incrementJobCounter(): Promise<number> {
  const r = getRedis();
  return r.incr('global:jobCounter');
}

export async function setKeyCooldown(keyIndex: number, cooldownSeconds: number): Promise<void> {
  const r = getRedis();
  await r.set(`key:${keyIndex}:cooldown`, '1', 'EX', cooldownSeconds);
}

export async function isKeyCoolingDown(keyIndex: number): Promise<boolean> {
  const r = getRedis();
  const val = await r.get(`key:${keyIndex}:cooldown`);
  return val !== null;
}

// ─── PDF Export Status ───────────────────────────────────────────────────────

export async function setPdfStatus(taskId: string, status: string, blobPath?: string): Promise<void> {
  const r = getRedis();
  const data: Record<string, string> = { status };
  if (blobPath) data.blobPath = blobPath;
  await r.hmset(`pdf:${taskId}`, data);
  await r.expire(`pdf:${taskId}`, 86400);
}

export async function getPdfStatus(taskId: string): Promise<{ status: string; blobPath?: string } | null> {
  const r = getRedis();
  const data = await r.hgetall(`pdf:${taskId}`);
  if (!data || !data.status) return null;
  return { status: data.status, blobPath: data.blobPath };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
