import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { FirmDetailClient } from '@/components/admin/FirmDetailClient';

export default async function FirmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    redirect('/my-account');
  }

  const firm = await prisma.firm.findUnique({
    where: { id },
    include: {
      users: {
        select: {
          id: true,
          displayId: true,
          name: true,
          email: true,
          jobTitle: true,
          isSuperAdmin: true,
          isFirmAdmin: true,
          isMethodologyAdmin: true,
          isResourceAdmin: true,
          isActive: true,
        },
        orderBy: { name: 'asc' },
      },
      _count: { select: { users: true, clients: true, auditEngagements: true } },
    },
  });

  if (!firm) notFound();

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <FirmDetailClient
        firm={{
          id: firm.id,
          name: firm.name,
          dataRegion: firm.dataRegion,
          email: firm.email,
          phone: firm.phone,
          website: firm.website,
          address: firm.address,
          registeredCompanyNumber: firm.registeredCompanyNumber,
          statutoryAuditorNumber: firm.statutoryAuditorNumber,
          counts: {
            users: firm._count.users,
            clients: firm._count.clients,
            engagements: firm._count.auditEngagements,
          },
        }}
        users={firm.users.map((u) => ({
          id: u.id,
          displayId: u.displayId,
          name: u.name,
          email: u.email,
          jobTitle: u.jobTitle,
          isSuperAdmin: u.isSuperAdmin,
          isFirmAdmin: u.isFirmAdmin,
          isMethodologyAdmin: u.isMethodologyAdmin,
          isResourceAdmin: u.isResourceAdmin,
          isActive: u.isActive,
        }))}
      />
    </div>
  );
}
