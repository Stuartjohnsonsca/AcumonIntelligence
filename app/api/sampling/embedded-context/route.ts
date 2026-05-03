import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Returns the props the embedded SamplingCalculatorClient needs when
// mounted inside the audit-test execution panel. The standalone /tools
// /sampling page resolves these on the server before rendering; this
// endpoint exposes the same shape over JSON so a client-side host
// (TestExecutionPanel) can hydrate the calculator without us having
// to thread userId / firmId / firmConfig through several component
// layers.
//
// Returns the period details when periodId is provided so the
// embedded calculator can populate selectedPeriod (used by sampling
// engagement + run logging).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const periodId = url.searchParams.get('periodId');
  const clientId = url.searchParams.get('clientId');

  const [user, firmConfig, period, client] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, firmId: true, firm: { select: { name: true } } },
    }),
    prisma.firmSamplingConfig.findUnique({
      where: { firmId: session.user.firmId },
      select: { confidenceLevel: true, confidenceFactorTable: true, riskMatrix: true },
    }),
    periodId
      ? prisma.clientPeriod.findUnique({
          where: { id: periodId },
          select: { id: true, startDate: true, endDate: true },
        })
      : Promise.resolve(null),
    clientId
      ? prisma.client.findUnique({
          where: { id: clientId },
          select: { id: true, clientName: true, software: true, contactFirstName: true, contactSurname: true, contactEmail: true },
        })
      : Promise.resolve(null),
  ]);

  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json({
    user: { id: user.id, name: user.name || '', firmId: user.firmId, firmName: user.firm?.name || '' },
    firmConfig: firmConfig
      ? {
          confidenceLevel: firmConfig.confidenceLevel,
          confidenceFactorTable: firmConfig.confidenceFactorTable as Record<string, unknown>[] | null,
          riskMatrix: firmConfig.riskMatrix as number[][] | null,
        }
      : null,
    period: period
      ? {
          id: period.id,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
        }
      : null,
    client: client || null,
  });
}
