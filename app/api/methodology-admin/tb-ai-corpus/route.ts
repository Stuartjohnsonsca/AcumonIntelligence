import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildCorpusForFirm } from '@/lib/tb-ai-corpus';

/**
 * GET /api/methodology-admin/tb-ai-corpus
 *
 * Returns the aggregated TB AI classifier corpus for the caller's
 * firm — one entry per distinct normalised description with:
 *   - sampleCount
 *   - canonical { fsNoteLevel, fsLevel, fsStatement }
 *   - consensusCount, aiAcceptedCount, aiOverriddenCount
 *   - variants (every distinct final answer seen, with counts)
 *
 * Served to methodologyAdmin / superAdmin only. Auditors don't need
 * the aggregate — they see the effect of the corpus via the AI
 * classifier auto-returning canonical answers.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const entries = await buildCorpusForFirm(session.user.firmId);
  return NextResponse.json({ entries });
}
