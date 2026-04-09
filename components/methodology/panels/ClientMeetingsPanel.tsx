'use client';

import { useState } from 'react';
import { MeetingsPanel } from './MeetingsPanel';

interface Props {
  engagementId: string;
}

export function ClientMeetingsPanel({ engagementId }: Props) {
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  async function handleEmailActions(meeting: any) {
    if (!meeting.minutes?.actionItems?.length) return;
    setEmailSending(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'email_actions',
          meetingId: meeting.id,
          emailType: 'team',
        }),
      });
      if (res.ok) {
        setEmailSent(meeting.id);
        setTimeout(() => setEmailSent(null), 3000);
      }
    } catch {}
    setEmailSending(false);
  }

  return (
    <div>
      {emailSent && (
        <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-[10px] text-green-700">
          Action items emailed to team members successfully.
        </div>
      )}
      <MeetingsPanel
        engagementId={engagementId}
        meetingType="client"
        defaultMeetingType="client"
        onEmailActions={handleEmailActions}
      />
    </div>
  );
}
