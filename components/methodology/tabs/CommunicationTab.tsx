'use client';

import { useState } from 'react';
import { CommunicationOverallPanel } from '../panels/CommunicationOverallPanel';
import { BoardMinutesPanel } from '../panels/BoardMinutesPanel';
import { TCWGPanel } from '../panels/TCWGPanel';
import { ClientMeetingsPanel } from '../panels/ClientMeetingsPanel';
import { InternalMeetingsPanel } from '../panels/InternalMeetingsPanel';
import { ExpertMeetingsPanel } from '../panels/ExpertMeetingsPanel';

interface Props {
  engagementId: string;
  clientId: string;
}

type SubTab = 'overall' | 'board-minutes' | 'tcwg' | 'client' | 'internal' | 'expert';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'board-minutes', label: 'Board Minutes' },
  { key: 'tcwg', label: 'Audit Committee / TCWG' },
  { key: 'client', label: 'With Client' },
  { key: 'internal', label: 'Internal Team' },
  { key: 'expert', label: 'With Expert' },
];

export function CommunicationTab({ engagementId, clientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('overall');

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 mb-4">
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subTab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {subTab === 'overall' && (
        <CommunicationOverallPanel engagementId={engagementId} onNavigate={(tab) => setSubTab(tab as SubTab)} />
      )}
      {subTab === 'board-minutes' && (
        <BoardMinutesPanel engagementId={engagementId} />
      )}
      {subTab === 'tcwg' && (
        <TCWGPanel engagementId={engagementId} />
      )}
      {subTab === 'client' && (
        <ClientMeetingsPanel engagementId={engagementId} />
      )}
      {subTab === 'internal' && (
        <InternalMeetingsPanel engagementId={engagementId} />
      )}
      {subTab === 'expert' && (
        <ExpertMeetingsPanel engagementId={engagementId} />
      )}
    </div>
  );
}
