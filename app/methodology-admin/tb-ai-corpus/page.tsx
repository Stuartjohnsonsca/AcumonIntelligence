import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { buildCorpusForFirm } from '@/lib/tb-ai-corpus';
import { TbAiCorpusClient } from '@/components/methodology-admin/TbAiCorpusClient';
import { BackButton } from '@/components/methodology-admin/BackButton';

export default async function TbAiCorpusPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/tb-ai-corpus');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  const entries = await buildCorpusForFirm(session.user.firmId);

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <BackButton href="/methodology-admin" label="Back to Methodology Admin" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">TB AI Classifier Corpus</h1>
        <p className="text-sm text-slate-500 mt-1">
          Aggregated learning from every TB classification your team has saved. Each row is one distinct
          description, the canonical answer auditors have converged on, and how often the AI got it right
          or wrong. High-override descriptions are the best candidates for prompt tuning or a canonical
          lookup. The classifier uses this data to short-circuit the LLM when a confident historical
          answer exists, and seeds the rest as few-shot examples.
        </p>
      </div>
      <TbAiCorpusClient entries={entries} />
    </div>
  );
}
