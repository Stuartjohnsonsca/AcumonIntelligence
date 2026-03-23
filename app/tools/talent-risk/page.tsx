import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AssuranceSubToolPage } from '@/components/tools/assurance/AssuranceSubToolPage';

export default async function TalentRiskPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; chatId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/talent-risk');
  }

  const params = await searchParams;

  if (!params.clientId) {
    const assignment = await prisma.userClientAssignment.findFirst({
      where: { userId: session.user.id },
      include: { client: true },
    });
    if (assignment?.client) {
      redirect(`/tools/talent-risk?clientId=${assignment.client.id}`);
    }
    redirect('/tools/assurance');
  }

  const client = await prisma.client.findFirst({
    where: { id: params.clientId, firmId: session.user.firmId },
  });
  if (!client) redirect('/tools/assurance');

  return (
    <AssuranceSubToolPage
      subToolKey="TalentRisk"
      subToolName="Workforce & Talent Risk"
      clientId={client.id}
      clientName={client.clientName}
      clientSector={client.sector}
    />
  );
}
