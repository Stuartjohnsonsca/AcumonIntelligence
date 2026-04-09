'use client';

import { MeetingsPanel } from './MeetingsPanel';

interface Props {
  engagementId: string;
}

export function InternalMeetingsPanel({ engagementId }: Props) {
  return (
    <MeetingsPanel
      engagementId={engagementId}
      meetingType="internal"
      defaultMeetingType="internal"
    />
  );
}
