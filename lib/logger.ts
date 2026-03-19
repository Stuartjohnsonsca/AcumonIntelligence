import { prisma } from '@/lib/db';

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

export async function logError(params: {
  userId?: string;
  route?: string;
  tool?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity?: 'error' | 'warning' | 'critical';
}) {
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

// Helper to extract request context for error logging
export function requestContext(req: Request) {
  return {
    url: req.url,
    method: req.method,
    userAgent: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
  };
}
