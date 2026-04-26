'use client';

import { useState, useEffect, useCallback } from 'react';
import { CommunicationOverallPanel } from '../panels/CommunicationOverallPanel';
import { BoardMinutesPanel } from '../panels/BoardMinutesPanel';
import { ShareholdersPanel } from '../panels/ShareholdersPanel';
import { TCWGPanel } from '../panels/TCWGPanel';
import { ClientMeetingsPanel } from '../panels/ClientMeetingsPanel';
import { InternalMeetingsPanel } from '../panels/InternalMeetingsPanel';
import { ExpertMeetingsPanel } from '../panels/ExpertMeetingsPanel';
import { SignOffDots } from '../SignOffDots';
import type { TeamMemberLite } from '@/lib/sign-off-helpers';
import { setCurrentLocation, subscribeNav, consumePendingNav } from '@/lib/engagement-nav';

interface Props {
  engagementId: string;
  clientId: string;
  teamMembers?: TeamMemberLite[];
  currentUserId?: string;
}

type SubTab = 'overall' | 'board-minutes' | 'shareholders' | 'tcwg' | 'client' | 'internal' | 'expert';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'board-minutes', label: 'Board Minutes' },
  { key: 'shareholders', label: 'Shareholders' },
  { key: 'tcwg', label: 'Audit Committee / TCWG' },
  { key: 'client', label: 'With Client' },
  { key: 'internal', label: 'Internal Team' },
  { key: 'expert', label: 'With Expert' },
];

type SignOffRecord = { userId?: string; userName?: string; timestamp?: string };
type SignOffBuckets = Record<string, Record<string, SignOffRecord>>;

export function CommunicationTab({ engagementId, teamMembers, currentUserId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('overall');
  const [signOffBuckets, setSignOffBuckets] = useState<SignOffBuckets>({});

  const loadSignOffs = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/communication`);
      if (res.ok) {
        const data = await res.json();
        setSignOffBuckets(data.signOffs || {});
      }
    } catch {}
  }, [engagementId]);

  useEffect(() => { loadSignOffs(); }, [loadSignOffs]);

  // ── Engagement-nav wiring ───────────────────────────────────────
  // Push current sub-tab into the registry and listen for back-links
  // that target this tab. Mirrors the pattern in WalkthroughsTab.
  useEffect(() => {
    const subLabel = SUB_TABS.find(t => t.key === subTab)?.label || subTab;
    setCurrentLocation({ tab: 'communication', subTab, label: `Communication › ${subLabel}` });
  }, [subTab]);

  useEffect(() => {
    const claimed = consumePendingNav(loc => loc.tab === 'communication');
    if (claimed?.subTab && SUB_TABS.some(t => t.key === claimed.subTab)) {
      setSubTab(claimed.subTab as SubTab);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeNav((target) => {
      if (target.tab !== 'communication' || !target.subTab) return;
      if (SUB_TABS.some(t => t.key === target.subTab)) {
        setSubTab(target.subTab as SubTab);
      }
    });
    return unsub;
  }, []);

  async function toggleSignOff(target: string, role: string) {
    const bucket = signOffBuckets[target] || {};
    const existing = bucket[role];
    const isUnsigning = existing?.userId === currentUserId;
    try {
      const res = await fetch(`/api/engagements/${engagementId}/communication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isUnsigning ? 'unsignoff' : 'signoff', target, role }),
      });
      if (res.ok) {
        const data = await res.json();
        setSignOffBuckets(data.signOffs || {});
      }
    } catch {}
  }

  const overallBucket = signOffBuckets['overall'] || {};

  return (
    <div>
      {/* Sub-tab bar + overall tab-level sign-off dots */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 flex-1 overflow-x-auto">
          {SUB_TABS.map(({ key, label }) => {
            const bucket = signOffBuckets[key] || {};
            const signedCount = ['preparer', 'reviewer', 'ri'].filter(r => bucket[r]?.timestamp).length;
            return (
              <button
                key={key}
                onClick={() => setSubTab(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  subTab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
                {key !== 'overall' && signedCount > 0 && (
                  <span className="text-[9px] text-green-600 font-semibold">{signedCount}/3</span>
                )}
              </button>
            );
          })}
        </div>
        {/* Tab-level overall sign-off — one row for the whole Communication tab */}
        <div className="shrink-0 border-l border-slate-200 pl-3">
          <SignOffDots
            label="Communications"
            signOffs={overallBucket}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
            onToggle={role => toggleSignOff('overall', role)}
            size="sm"
            hideRoleLabels
          />
        </div>
      </div>

      {/* Sub-tab content */}
      {subTab === 'overall' && (
        <CommunicationOverallPanel
          engagementId={engagementId}
          onNavigate={(tab) => setSubTab(tab as SubTab)}
        />
      )}
      {subTab === 'board-minutes' && (
        <BoardMinutesPanel
          engagementId={engagementId}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          subTabKey="board-minutes"
          subTabSignOffs={signOffBuckets['board-minutes'] || {}}
          onSubTabSignOff={role => toggleSignOff('board-minutes', role)}
        />
      )}
      {subTab === 'shareholders' && (
        <ShareholdersPanel
          engagementId={engagementId}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          subTabKey="shareholders"
          subTabSignOffs={signOffBuckets['shareholders'] || {}}
          onSubTabSignOff={role => toggleSignOff('shareholders', role)}
        />
      )}
      {subTab === 'tcwg' && (
        <TCWGPanel
          engagementId={engagementId}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          subTabKey="tcwg"
          subTabSignOffs={signOffBuckets['tcwg'] || {}}
          onSubTabSignOff={role => toggleSignOff('tcwg', role)}
        />
      )}
      {subTab === 'client' && (
        <div>
          {/* Per-sub-tab overall dots in the panel heading */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Client Meetings</h3>
            <SignOffDots
              label="Client sign-off"
              signOffs={signOffBuckets['client'] || {}}
              teamMembers={teamMembers}
              currentUserId={currentUserId}
              onToggle={role => toggleSignOff('client', role)}
              size="sm"
              hideRoleLabels
            />
          </div>
          <ClientMeetingsPanel engagementId={engagementId} />
        </div>
      )}
      {subTab === 'internal' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Internal Team Meetings</h3>
            <SignOffDots
              label="Internal sign-off"
              signOffs={signOffBuckets['internal'] || {}}
              teamMembers={teamMembers}
              currentUserId={currentUserId}
              onToggle={role => toggleSignOff('internal', role)}
              size="sm"
              hideRoleLabels
            />
          </div>
          <InternalMeetingsPanel engagementId={engagementId} />
        </div>
      )}
      {subTab === 'expert' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Expert Meetings</h3>
            <SignOffDots
              label="Expert sign-off"
              signOffs={signOffBuckets['expert'] || {}}
              teamMembers={teamMembers}
              currentUserId={currentUserId}
              onToggle={role => toggleSignOff('expert', role)}
              size="sm"
              hideRoleLabels
            />
          </div>
          <ExpertMeetingsPanel engagementId={engagementId} />
        </div>
      )}
    </div>
  );
}
