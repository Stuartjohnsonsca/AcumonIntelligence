import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { MessagingProvidersClient } from '@/components/methodology-admin/MessagingProvidersClient';

export default async function MessagingProvidersPage() {
  const session = await auth();
  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/methodology-admin/messaging-providers');
  }
  // Strictly Super Admin — provider credentials are platform-wide
  // secrets, not firm-level. Methodology Admin without Super Admin
  // shouldn't see them.
  if (!session.user.isSuperAdmin) {
    redirect('/access-denied');
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <div className="mb-6">
        <a href="/methodology-admin" className="text-sm text-blue-600 hover:underline">← Back to Admin</a>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Messaging Providers</h1>
        <p className="text-slate-600 mt-1">
          Credentials for SMS / WhatsApp / Telegram / WeChat. Stored in <code>messaging_provider_configs</code>;
          the messaging library reads these at send time so changes take effect on the next outbound message
          (60-second in-memory cache; admin saves invalidate it immediately).
          Each provider falls back to environment variables when its DB row is disabled — useful during the
          transition from env-only to DB-managed configuration.
        </p>
      </div>
      <MessagingProvidersClient />
    </div>
  );
}
