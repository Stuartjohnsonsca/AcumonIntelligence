'use client';

import { FileUploadSection } from './FileUploadSection';
import { OpeningPositionSection } from './OpeningPositionSection';
import { CombineButtons } from './CombineButtons';
import { JournalButtons } from './JournalButtons';
import { ExportSection } from './ExportSection';

interface Props {
  chartOfAccounts: { id: string; accountCode: string; accountName: string; categoryType: string; sortOrder: number }[];
  sessionId: string;
  userId: string;
}

export function ControlsPanel({ chartOfAccounts, sessionId, userId }: Props) {
  return (
    <div className="p-3 space-y-4">
      <FileUploadSection sessionId={sessionId} />

      <div className="border-t pt-4">
        <OpeningPositionSection sessionId={sessionId} />
      </div>

      <div className="border-t pt-4">
        <CombineButtons sessionId={sessionId} chartOfAccounts={chartOfAccounts} />
      </div>

      <div className="border-t pt-4">
        <JournalButtons sessionId={sessionId} chartOfAccounts={chartOfAccounts} />
      </div>

      <div className="border-t pt-4">
        <ExportSection sessionId={sessionId} />
      </div>
    </div>
  );
}
