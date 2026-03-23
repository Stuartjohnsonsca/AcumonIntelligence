import { prisma } from '@/lib/db';
import { randomUUID } from 'crypto';

// ─── Activity Logging ────────────────────────────────────────────────────────

export async function logActivity(params: {
  userId?: string;
  firmId?: string;
  clientId?: string;
  action: string;
  tool?: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await prisma.activityLog.create({
      data: {
        ...params,
        detail: params.detail ? JSON.stringify(params.detail) : null,
      },
    });
  } catch (e) {
    console.error('[Logger] Failed to write activity log:', e);
  }
}

// ─── Error Logging ───────────────────────────────────────────────────────────

export async function logError(params: {
  userId?: string;
  route?: string;
  tool?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity?: 'error' | 'warning' | 'critical';
}) {
  // Always console.error so it appears in Vercel logs
  console.error(`[${params.severity || 'error'}] ${params.route || '?'} | ${params.tool || '?'} | ${params.message}`);

  try {
    await prisma.errorLog.create({
      data: {
        ...params,
        context: params.context ? JSON.stringify(params.context) : null,
        severity: params.severity || 'error',
      },
    });
  } catch (e) {
    console.error('[Logger] Failed to write error log:', e);
  }
}

// ─── Request Context Helper ──────────────────────────────────────────────────

export function requestContext(req: Request) {
  return {
    url: req.url,
    method: req.method,
    userAgent: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
  };
}

// ─── API Action Logger ───────────────────────────────────────────────────────
//
// Comprehensive logging for API route actions. Creates an action ID that ties
// together the activity log entry, any error logs, and console output for a
// single request. Use this at the start of every API handler.
//
// Usage:
//   const action = apiAction(req, session?.user, '/api/sampling/run', 'sampling');
//   action.info('Starting sampling run', { method: 'random', seed: 42 });
//   try { ... action.success('Run complete', { itemCount: 25 }); }
//   catch (err) { action.error(err); return action.errorResponse(err); }

export interface ApiActionUser {
  id: string;
  firmId?: string;
  name?: string;
  email?: string;
}

export interface ApiAction {
  actionId: string;
  info: (message: string, detail?: Record<string, unknown>) => void;
  warn: (message: string, detail?: Record<string, unknown>) => void;
  success: (message: string, detail?: Record<string, unknown>) => Promise<void>;
  error: (err: unknown, detail?: Record<string, unknown>) => Promise<void>;
  errorResponse: (err: unknown, status?: number) => Response;
}

export function apiAction(
  req: Request,
  user: ApiActionUser | null | undefined,
  route: string,
  tool: string,
): ApiAction {
  const actionId = randomUUID().slice(0, 12);
  const startTime = Date.now();
  const userId = user?.id;
  const firmId = user?.firmId;
  const ctx = requestContext(req);

  const prefix = `[${tool}:${route.split('/').pop()}:${actionId}]`;

  return {
    actionId,

    info(message: string, detail?: Record<string, unknown>) {
      console.log(`${prefix} ${message}`, detail ? JSON.stringify(detail) : '');
    },

    warn(message: string, detail?: Record<string, unknown>) {
      console.warn(`${prefix} WARN: ${message}`, detail ? JSON.stringify(detail) : '');
      // Fire-and-forget warning to DB
      logError({
        userId,
        route,
        tool,
        message: `[${actionId}] ${message}`,
        context: { ...ctx, ...detail, actionId, firmId },
        severity: 'warning',
      }).catch(() => {});
    },

    async success(message: string, detail?: Record<string, unknown>) {
      const elapsed = Date.now() - startTime;
      console.log(`${prefix} OK (${elapsed}ms): ${message}`);
      // Log activity
      logActivity({
        userId,
        firmId,
        action: `${tool}:${route.split('/').pop()}`,
        tool,
        detail: { ...detail, actionId, elapsed, status: 'success' },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      }).catch(() => {});
    },

    async error(err: unknown, detail?: Record<string, unknown>) {
      const elapsed = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined;
      console.error(`${prefix} FAIL (${elapsed}ms): ${msg}`);
      await logError({
        userId,
        route,
        tool,
        message: `[${actionId}] ${msg}`,
        stack,
        context: { ...ctx, ...detail, actionId, firmId, elapsed },
        severity: 'error',
      });
    },

    errorResponse(err: unknown, status = 500): Response {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: msg, actionId },
        { status },
      );
    },
  };
}
