import { SpecialistPortalHubClient } from '@/components/specialist-portal/SpecialistPortalHubClient';

/**
 * Specialist Hub — public route, cross-engagement view.
 *
 * Auth is the (email, sig) pair on the query string where sig is
 * the hub HMAC (signs `hub|<email>` only). Lets the same specialist
 * see every chat across every engagement they're configured on
 * without one signed URL per engagement.
 *
 * The engagement-locked URL (/specialist-portal/[engagementId]/[roleKey])
 * still works — this page is additive and doesn't replace it.
 */
export default async function SpecialistPortalHubPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sig?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <SpecialistPortalHubClient
          email={sp.email || ''}
          sig={sp.sig || ''}
        />
      </div>
    </div>
  );
}
