import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AssuranceSubToolPage } from '@/components/tools/assurance/AssuranceSubToolPage';

export default async function ESGSustainabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; chatId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/tools/esg-sustainability');
  }

  const params = await searchParams;

  if (!params.clientId) {
    const assignment = await prisma.userClientAssignment.findFirst({
      where: { userId: session.user.id },
      include: { client: true },
    });
    if (assignment?.client) {
      redirect(`/tools/esg-sustainability?clientId=${assignment.client.id}`);
    }
    redirect('/tools/assurance');
  }

  const client = await prisma.client.findFirst({
    where: { id: params.clientId, firmId: session.user.firmId },
  });
  if (!client) redirect('/tools/assurance');

  return (
    <AssuranceSubToolPage
      subToolKey="ESGSustainability"
      subToolName="ESG & Sustainability"
      clientId={client.id}
      clientName={client.clientName}
      clientSector={client.sector}
    />
  );
}
