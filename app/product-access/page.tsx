import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface Props {
  searchParams: Promise<{ prefix?: string }>;
}

export default async function ProductAccessPage({ searchParams }: Props) {
  const session = await auth();
  const { prefix } = await searchParams;

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
    // Route to internal tool page instead of external subdomain
    const internalRoutes: Record<string, string> = {
      DateExtraction: '/tools/data-extraction',
      DocSummary: '/tools/doc-summary',
      PortfolioExtraction: '/tools/portfolio-extraction',
      FSChecker: '/tools/fs-checker',
      Sampling: '/tools/sampling',
      BankAudit: '/tools/bank-audit',
      BankReceipts: '/tools/bank-receipts',
      BankPayments: '/tools/bank-payments',
      DebtorsVerification: '/tools/debtors-verification',
      CreditorsVerification: '/tools/creditors-verification',
      JournalsTesting: '/tools/journals-testing',
      UnusualBankTxn: '/tools/unusual-bank-txn',
      FSAssertions: '/tools/fs-assertions',
      BankToTB: '/tools/bank-to-tb',
      AddJrnls: '/tools/add-jrnls',
      Governance: '/tools/governance',
      CyberResiliance: '/tools/cyber-resilience',
      TalentRisk: '/tools/talent-risk',
      ESGSustainability: '/tools/esg-sustainability',
      Diversity: '/tools/diversity',
    };
    const internalPath = internalRoutes[prefix];
    if (internalPath) redirect(internalPath);
    // Fallback to subdomain for tools not yet built
    redirect(`https://${prefix.toLowerCase()}.acumonintelligence.com`);
  }

  // No access - redirect to access denied page
  redirect(`/access-denied?prefix=${prefix}`);
}
