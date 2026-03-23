import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AssuranceHubClient } from '@/components/tools/assurance/AssuranceHubClient';

export default async function AssuranceHubPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; chatId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/assurance');
  }

  const params = await searchParams;

  // If no clientId, show a client selector or redirect
  if (!params.clientId) {
    // Get the user's first active client as default
    const assignment = await prisma.userClientAssignment.findFirst({
      where: { userId: session.user.id },
      include: { client: true },
    });

    if (assignment?.client) {
      redirect(`/tools/assurance?clientId=${assignment.client.id}`);
    }

    // No clients assigned - show a message
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Assurance Hub</h1>
          <p className="text-slate-500">
            No clients are assigned to your account. Please contact your administrator to get started.
          </p>
        </div>
      </div>
    );
  }

  // Verify client access
  const client = await prisma.client.findFirst({
    where: {
      id: params.clientId,
      firmId: session.user.firmId,
    },
  });

  if (!client) {
    redirect('/tools/assurance');
  }

  return (
    <AssuranceHubClient
      clientId={client.id}
      clientName={client.clientName}
      initialChatId={params.chatId}
    />
  );
}
