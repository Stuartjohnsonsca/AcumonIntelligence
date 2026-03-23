import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { RiskChatClient } from '@/components/tools/risk/RiskChatClient';

export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; chatId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/risk');
  }

  const params = await searchParams;

  // If no clientId, find the user's first active client as default
  if (!params.clientId) {
    const assignment = await prisma.userClientAssignment.findFirst({
      where: { userId: session.user.id },
      include: { client: true },
    });

    if (assignment?.client) {
      redirect(`/tools/risk?clientId=${assignment.client.id}`);
    }

    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Risk Advisory</h1>
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
    redirect('/tools/risk');
  }

  return (
    <RiskChatClient
      clientId={client.id}
      clientName={client.clientName}
      initialChatId={params.chatId}
    />
  );
}
