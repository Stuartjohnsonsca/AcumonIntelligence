import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { OrgPickerClient } from './OrgPickerClient';

export default async function XeroSelectOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ pendingId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login');
  }

  const params = await searchParams;
  const pendingId = params.pendingId;
  if (!pendingId) {
    redirect('/tools/data-extraction?xeroError=missing_pending_id');
  }

  const pending = await prisma.pendingXeroAuth.findUnique({
    where: { id: pendingId },
  });

  if (!pending) {
    redirect('/tools/data-extraction?xeroError=pending_auth_expired');
  }

  // Check it's not too old (5 minute window)
  const ageMs = Date.now() - pending.createdAt.getTime();
  if (ageMs > 5 * 60 * 1000) {
    await prisma.pendingXeroAuth.delete({ where: { id: pendingId } });
    redirect('/tools/data-extraction?xeroError=pending_auth_expired');
  }

  const client = await prisma.client.findUnique({
    where: { id: pending.clientId },
    select: { clientName: true },
  });

  const tenants = pending.tenants as { tenantId: string; tenantName: string; createdDateUtc?: string }[];

  return (
    <OrgPickerClient
      pendingId={pendingId}
      clientName={client?.clientName || 'Unknown Client'}
      tenants={tenants}
    />
  );
}
