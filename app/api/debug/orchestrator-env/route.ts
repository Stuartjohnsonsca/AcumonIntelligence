// TEMP diagnostic endpoint — confirms whether ORCHESTRATOR_URL /
// ORCHESTRATOR_SECRET env vars are visible to the deployed runtime.
// Returns lengths only — never the values themselves.
//
// Authenticated by NextAuth (any signed-in user). Remove once
// the server-driven import flow is verified working.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.ORCHESTRATOR_URL || '';
  const secret = process.env.ORCHESTRATOR_SECRET || '';
  return NextResponse.json({
    orchestratorUrlSet: Boolean(url),
    orchestratorUrlLength: url.length,
    orchestratorUrlHost: url ? new URL(url.startsWith('http') ? url : `https://${url}`).host : null,
    orchestratorSecretSet: Boolean(secret),
    orchestratorSecretLength: secret.length,
    orchestratorSecretFirstByte: secret ? secret.charCodeAt(0) : null,
    nodeEnv: process.env.NODE_ENV,
  });
}
