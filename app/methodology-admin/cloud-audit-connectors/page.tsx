import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { CloudAuditConnectorsAdmin } from '@/components/methodology-admin/CloudAuditConnectorsAdmin';

export default async function CloudAuditConnectorsPage() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/cloud-audit-connectors');
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin && !session.user.isFirmAdmin) {
    redirect('/access-denied');
  }
  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Cloud Audit Software Connectors</h1>
        <p className="text-slate-600 text-sm mt-1">
          Recipes for fetching prior audit files from third-party audit software during the
          Import Options flow at engagement start. Credentials are entered per fetch and never
          persisted on this screen — only the connection recipe (base URL, auth scheme, endpoint
          paths) lives here.
        </p>
      </div>
      <CloudAuditConnectorsAdmin />
    </div>
  );
}
