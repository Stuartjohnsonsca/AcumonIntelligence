'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Mail, Loader2 } from 'lucide-react';
import { useBankToTB } from './BankToTBContext';

interface Props {
  sessionId: string;
}

export function ExportSection({ sessionId }: Props) {
  const { state } = useBankToTB();
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [showEmail, setShowEmail] = useState(false);

  if (state.trialBalance.length === 0) return null;

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch('/api/bank-to-tb/export/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bank-to-TB-Export.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleEmail() {
    if (!emailAddress.trim()) return;
    setEmailing(true);
    try {
      const res = await fetch('/api/bank-to-tb/export/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, recipientEmail: emailAddress }),
      });

      if (!res.ok) throw new Error('Email failed');
      alert('Export sent successfully');
      setShowEmail(false);
      setEmailAddress('');
    } catch (err) {
      console.error('Email failed:', err);
    } finally {
      setEmailing(false);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">Export</h3>
      <Button size="sm" variant="outline" className="w-full" onClick={handleDownload} disabled={downloading}>
        {downloading ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Download className="h-3 w-3 mr-2" />}
        Download
      </Button>
      <Button size="sm" variant="outline" className="w-full" onClick={() => setShowEmail(!showEmail)}>
        <Mail className="h-3 w-3 mr-2" />
        Email
      </Button>

      {showEmail && (
        <div className="space-y-1">
          <input
            type="email"
            value={emailAddress}
            onChange={e => setEmailAddress(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button size="sm" onClick={handleEmail} disabled={emailing || !emailAddress.trim()} className="w-full">
            {emailing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
