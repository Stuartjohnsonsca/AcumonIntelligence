import { prisma } from '@/lib/db';
import Link from 'next/link';
import XeroConnectForm from '@/components/XeroConnectForm';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function XeroAuthorisePage({ params }: Props) {
  const { token } = await params;

  const request = await prisma.xeroAuthRequest.findUnique({
    where: { token },
    include: {
      client: {
        select: { clientName: true, contactName: true },
      },
    },
  });

  if (!request) {
    return (
      <PageShell>
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Invalid Link</h2>
          <p className="text-slate-500">This authorisation link is not valid. It may have already been used or does not exist.</p>
        </div>
      </PageShell>
    );
  }

  if (request.status === 'authorised') {
    return (
      <PageShell>
        <div className="text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Already Authorised</h2>
          <p className="text-slate-500">
            Xero access for <strong>{request.client.clientName}</strong> has already been authorised.
            The connection is active and will expire automatically after 30 days.
          </p>
        </div>
      </PageShell>
    );
  }

  if (new Date() > request.expiresAt || request.status === 'expired') {
    return (
      <PageShell>
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Link Expired</h2>
          <p className="text-slate-500">
            This authorisation link has expired. Please ask your auditor to send a new request.
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-slate-800 mb-2">Xero Access Request</h2>
        <p className="text-slate-600 mb-6">
          <strong>{request.requestedBy}</strong> has requested read-only access to the
          <strong> {request.client.clientName}</strong> Xero account for audit and assurance purposes.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-semibold text-slate-700 text-sm mb-2">What this grants:</h3>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>• <strong>Read-only</strong> access to transactions, account codes, and contacts</li>
            <li>• No changes will be made to your Xero data</li>
            <li>• Access will <strong>automatically expire after 30 days</strong></li>
            <li>• You can revoke access at any time from your Xero connected apps settings</li>
          </ul>
        </div>

        <XeroConnectForm token={token} recipientEmail={request.recipientEmail} />
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#1e3a5f] to-[#2563eb] px-6 py-5">
            <Link href="/" className="flex items-center gap-2">
              <h1 className="text-white text-xl font-bold">Acumon Intelligence</h1>
            </Link>
          </div>
          <div className="p-8">{children}</div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          Acumon Intelligence · <a href="https://www.acumonintelligence.com" className="underline">www.acumonintelligence.com</a>
        </p>
      </div>
    </div>
  );
}
