import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { TemplateDocumentsHub } from '@/components/methodology-admin/TemplateDocumentsHub';

export default async function TemplateDocumentsPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/template-documents');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <TemplateDocumentsHub />
    </div>
  );
}
