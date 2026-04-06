import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logError } from '@/lib/logger';

/**
 * POST /api/error-report
 * Client-side error reporter — receives errors from error boundaries and logs them to the DB.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { message, stack, route, engagementId, context } = body;

    if (!message) {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }

    await logError({
      userId: session.user.id,
      firmId: session.user.firmId,
      engagementId: engagementId || undefined,
      route: route || undefined,
      tool: 'client-ui',
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 5000) : undefined,
      context: typeof context === 'object' ? context : undefined,
      severity: 'error',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[error-report] Failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
