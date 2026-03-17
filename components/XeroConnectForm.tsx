'use client';

import { useState } from 'react';

interface XeroConnectFormProps {
  token: string;
  recipientEmail: string;
}

export default function XeroConnectForm({ token, recipientEmail }: XeroConnectFormProps) {
  const [email, setEmail] = useState(recipientEmail);
  const [submitting, setSubmitting] = useState(false);

  const connectUrl = `/api/accounting/xero/client-connect?token=${encodeURIComponent(token)}&login_hint=${encodeURIComponent(email)}`;

  return (
    <div className="mt-6">
      <label htmlFor="xero-email" className="block text-sm font-medium text-slate-700 text-left mb-1.5">
        Xero login email
      </label>
      <input
        id="xero-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your-xero-login@example.com"
        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2"
      />
      <p className="text-xs text-slate-400 text-left mb-5">
        Enter the email address you use to sign in to Xero. This may differ from the email this link was sent to.
      </p>

      <a
        href={connectUrl}
        onClick={() => setSubmitting(true)}
        className={`inline-flex items-center gap-2 bg-[#13b5ea] hover:bg-[#0d9bc7] text-white font-semibold py-3 px-8 rounded-lg text-lg transition-colors shadow-lg ${submitting ? 'opacity-60 pointer-events-none' : ''}`}
      >
        {submitting ? 'Connecting…' : 'Connect to Xero'}
      </a>

      <p className="text-xs text-slate-400 mt-4">
        You will be redirected to Xero to sign in and authorise the connection.
      </p>
    </div>
  );
}
