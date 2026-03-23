import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET - list user's active tool sessions grouped by tool > client > period
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const sessions = await prisma.toolSession.findMany({
    where: { userId: session.user.id },
    orderBy: { lastAccessed: 'desc' },
  });

  // Group by tool > client > period
  const grouped: Record<string, {
    toolKey: string;
    clients: Record<string, {
      clientName: string;
      periods: { id: string; periodLabel: string; toolPath: string; lastAccessed: Date }[];
    }>;
  }> = {};

  const toolLabels: Record<string, string> = {
    'bank-to-tb': 'Bank to TB',
    'sampling': 'Sample Calculator',
    'data-extraction': 'Data Extraction',
    'doc-summary': 'Document Summary',
  };

  for (const s of sessions) {
    if (!grouped[s.toolKey]) {
      grouped[s.toolKey] = {
        toolKey: s.toolKey,
        clients: {},
      };
    }

    if (!grouped[s.toolKey].clients[s.clientId]) {
      grouped[s.toolKey].clients[s.clientId] = {
        clientName: s.clientName,
        periods: [],
      };
    }

    grouped[s.toolKey].clients[s.clientId].periods.push({
      id: s.id,
      periodLabel: s.periodLabel || 'No period',
      toolPath: s.toolPath,
      lastAccessed: s.lastAccessed,
    });
  }

  // Convert to array format for easier rendering
  const result = Object.entries(grouped).map(([toolKey, data]) => ({
    toolKey,
    toolLabel: toolLabels[toolKey] || toolKey,
    clients: Object.entries(data.clients).map(([clientId, clientData]) => ({
      clientId,
      clientName: clientData.clientName,
      periods: clientData.periods,
    })),
  }));

  return NextResponse.json({ sessions: result });
}
