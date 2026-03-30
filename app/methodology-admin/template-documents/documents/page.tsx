import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { DocumentManagerClient } from '@/components/methodology-admin/DocumentManagerClient';

export default async function DocumentManagerPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/template-documents/documents');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    redirect('/access-denied');
  }

  // Documents will be loaded from API — start empty for now
  // Future: fetch from prisma.uploadedDocument.findMany(...)
  const initialDocuments: any[] = [];

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <DocumentManagerClient initialDocuments={initialDocuments} />
    </div>
  );
}
