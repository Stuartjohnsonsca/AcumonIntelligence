import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { TeamFamiliarityClient } from '@/components/methodology-admin/TeamFamiliarityClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function TeamFamiliarityPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) redirect('/login');
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    redirect('/my-account');
  }

  return (
    <div data-howto-id="page.audit-methodology-team-familiarity.body" className="container mx-auto px-4 py-8 max-w-7xl">
      <BackButton href="/methodology-admin/audit-methodology" label="Back to Audit Methodology" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Team Familiarity</h1>
        <p className="text-slate-600 mt-1">
          Track how long each team member has served each audit client in each role. Set RI familiarity limits
          to enforce rotation rules — assignments that would breach the limit are blocked when saving the team.
        </p>
      </div>
      <TeamFamiliarityClient />
    </div>
  );
}
