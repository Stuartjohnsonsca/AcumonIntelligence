import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AUDIT_TOOLS, AUDIT_TOOLS_GROUP, type AuditTool } from '@/lib/audit-tools';
import type { ToolAvailability } from '@/types/methodology';

/**
 * Audit Tools availability for an engagement.
 *
 * Returns the firm-wide AUDIT_TOOLS catalog with each entry tagged
 * by its availability. The setting is sourced from
 * MethodologyToolSetting where:
 *   toolName   = AUDIT_TOOLS_GROUP
 *   methodName = AuditTool.label
 *   auditType  = 'ALL'   (per-audit-type granularity was removed
 *                         from the admin page — the firm's
 *                         purchasing decision applies across every
 *                         audit type)
 *
 * When no setting exists, the tool defaults to 'available' to
 * match the admin grid's default for unset cells.
 *
 * Used by PlanCustomiserModal to populate the Audit Tools
 * dropdown — only tools whose availability is 'available' or
 * 'discretion' show; 'unavailable' tools are filtered out
 * because the firm hasn't purchased them.
 */

interface ResolvedAuditTool extends AuditTool {
  availability: ToolAvailability;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, auditType: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }
  if (engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Pull only the 'ALL' rows for this firm + tool group. Legacy
  // per-audit-type rows from before the admin page was simplified
  // are ignored on read so the engagement view always matches
  // what the admin sees in the grid.
  const settings = await prisma.methodologyToolSetting.findMany({
    where: {
      firmId: engagement.firmId,
      toolName: AUDIT_TOOLS_GROUP,
      auditType: 'ALL',
    },
    select: { methodName: true, availability: true },
  });

  const byMethod = new Map<string, ToolAvailability>();
  for (const s of settings) {
    byMethod.set(s.methodName, s.availability as ToolAvailability);
  }

  function resolve(tool: AuditTool): ToolAvailability {
    return byMethod.get(tool.label) ?? 'available';
  }

  const tools: ResolvedAuditTool[] = AUDIT_TOOLS.map(t => ({ ...t, availability: resolve(t) }));

  return NextResponse.json({ tools, auditType: engagement.auditType });
}
