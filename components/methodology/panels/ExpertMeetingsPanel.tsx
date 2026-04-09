'use client';

import { useState } from 'react';
import { MeetingsPanel } from './MeetingsPanel';

interface Props {
  engagementId: string;
}

export function ExpertMeetingsPanel({ engagementId }: Props) {
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
          emailType: 'expert',
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
          Summary and action items emailed to expert for confirmation.
        </div>
      )}
      <MeetingsPanel
        engagementId={engagementId}
        meetingType="expert"
        defaultMeetingType="expert"
        onEmailActions={handleEmailActions}
      />
    </div>
  );
}
