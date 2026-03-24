import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MyAccountClient } from '@/components/my-account/MyAccountClient';

export default async function MyAccountPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/my-account');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { firm: true },
  });

  if (!user) redirect('/login');

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">My Account</h1>
        <p className="text-slate-600 mt-1">
          {user.firm.name} &middot; {user.displayId}
        </p>
      </div>
      <MyAccountClient
        userId={user.id}
        firmId={user.firmId}
        isSuperAdmin={user.isSuperAdmin}
        isFirmAdmin={user.isFirmAdmin}
        isPortfolioOwner={user.isPortfolioOwner}
        isMethodologyAdmin={user.isMethodologyAdmin}
      />
    </div>
  );
}
