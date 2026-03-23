import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/portal/debug
 * Debug endpoint to check portal data. Remove after testing.
 */
export async function GET() {
  try {
    const portalUsers = await prisma.clientPortalUser.findMany({
      select: { id: true, email: true, clientId: true, isActive: true, lastLoginAt: true },
    });

    const evidenceCount = await prisma.auditEvidenceRequest.count();

    const evidenceSample = await prisma.auditEvidenceRequest.findMany({
      take: 3,
      select: { id: true, clientId: true, transactionId: true, description: true, status: true },
      orderBy: { createdAt: 'desc' },
    });

    const clients = await prisma.client.findMany({
      select: { id: true, clientName: true },
    });

    return NextResponse.json({
      portalUsers,
      evidenceRequestCount: evidenceCount,
      evidenceSample,
      clients,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
