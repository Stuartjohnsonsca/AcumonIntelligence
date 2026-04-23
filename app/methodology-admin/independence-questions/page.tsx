import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/methodology-admin/BackButton';
import { IndependenceQuestionsClient } from '@/components/methodology-admin/IndependenceQuestionsClient';
import { getFirmIndependenceQuestions, defaultIndependenceQuestions } from '@/lib/independence';

/**
 * Methodology Admin → Firm-Wide Assumptions → Independence Questions.
 *
 * Firm-wide list of questions each team member must answer before they can
 * access any engagement on the firm. Served from a MethodologyTemplate row
 * (templateType='independence_questions', auditType='ALL'). Seeded with a
 * reasonable default set on first visit so the admin isn't staring at an
 * empty screen.
 */
export default async function IndependenceQuestionsPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/independence-questions');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const existing = await getFirmIndependenceQuestions(session.user.firmId);
  const initial = existing.length > 0 ? existing : defaultIndependenceQuestions();

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Independence Questions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Firm-wide questionnaire that every team member must complete before they can view or interact with an
          engagement. When a team member declares themselves NOT independent, the Responsible Individual and the
          Ethics Partner are emailed automatically and the team member is locked out of the engagement until the
          matter is resolved.
        </p>
      </div>
      <IndependenceQuestionsClient initialQuestions={initial} />
    </div>
  );
}
