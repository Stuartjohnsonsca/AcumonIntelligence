import { SpecialistReviewClient } from '@/components/specialist-review/SpecialistReviewClient';

/**
 * Specialist-review magic-link page. Public — the token is the auth.
 * Specialist opens the link from their email, reads the schedule
 * details, types comments, and clicks Accept or Reject.
 */
export default async function SpecialistReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <SpecialistReviewClient token={token} />
      </div>
    </div>
  );
}
