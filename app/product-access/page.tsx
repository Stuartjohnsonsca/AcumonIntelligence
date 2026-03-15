import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface Props {
  searchParams: { prefix?: string };
}

export default async function ProductAccessPage({ searchParams }: Props) {
  const session = await auth();
  const prefix = searchParams.prefix;

  if (!prefix) redirect('/');

  // Not logged in - redirect to login remembering the product
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect(`/login?redirect=${prefix}`);
  }

  // Check subscription access for this user's firm clients
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      clientAssignments: {
        include: {
          client: {
            include: {
              subscriptions: {
                where: {
                  isActive: true,
                  expiryDate: { gt: new Date() },
                  product: { urlPrefix: prefix },
                },
                include: { product: true },
              },
            },
          },
        },
      },
    },
  });

  const hasAccess = user?.clientAssignments.some(
    (assignment) => assignment.client.subscriptions.length > 0
  );

  // Super admins and firm admins always have access
  const isPrivileged = session.user.isSuperAdmin || session.user.isFirmAdmin;

  if (hasAccess || isPrivileged) {
    // Redirect to the product subdomain
    redirect(`https://${prefix.toLowerCase()}.acumonintelligence.com`);
  }

  // No access - redirect to access denied page
  redirect(`/access-denied?prefix=${prefix}`);
}
