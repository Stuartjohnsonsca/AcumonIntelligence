import { SpecialistPortalClient } from '@/components/specialist-portal/SpecialistPortalClient';

/**
 * External Specialist Portal — public route. Gives an external
 * specialist scoped access to:
 *   - one engagement (the engagementId in the URL)
 *   - one role     (the roleKey in the URL)
 *   - the chat items the team has opened against that role
 *
 * Auth is the (email, sig) pair on the query string — the server
 * routes all run through verifyPortalToken before returning data.
 *
 * Nothing else on the engagement is exposed: the specialist can't
 * reach any other tab, any other engagement, or any other firm
 * data.
 */
export default async function SpecialistPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string; roleKey: string }>;
  searchParams: Promise<{ email?: string; sig?: string }>;
}) {
  const { engagementId, roleKey } = await params;
  const sp = await searchParams;
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <SpecialistPortalClient
          engagementId={engagementId}
          roleKey={roleKey}
          email={sp.email || ''}
          sig={sp.sig || ''}
        />
      </div>
    </div>
  );
}
