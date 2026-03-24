'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuditType } from '@/types/methodology';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import { TeamPanel } from '../panels/TeamPanel';
import { ClientContactsPanel } from '../panels/ClientContactsPanel';

// Extended type for info requests that may have a receivedAt field
type InfoRequestWithReceived = { receivedAt?: string | null };

interface Props {
  engagement: EngagementData;
  auditType: AuditType;
  clientName: string;
  periodEndDate: string | null;
  onEngagementUpdate?: (updated: EngagementData) => void;
}

export function OpeningTab({ engagement, auditType, clientName, periodEndDate, onEngagementUpdate }: Props) {
  const [isGroupAudit, setIsGroupAudit] = useState(engagement.isGroupAudit);
  const [showCategory, setShowCategory] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsGroupAudit(engagement.isGroupAudit);
  }, [engagement.isGroupAudit]);

  async function updateSetting(field: string, value: boolean | string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/engagements/${engagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        if (onEngagementUpdate) onEngagementUpdate(data.engagement);
      }
    } catch (err) {
      console.error('Failed to update setting:', err);
    } finally {
      setSaving(false);
    }
  }

  const mainContact = engagement.contacts.find(c => c.isMainContact) || engagement.contacts[0];

  // Team members may have userName directly or nested user.name from API
  type MemberWithUser = typeof engagement.teamMembers[number] & { user?: { name: string; email: string } };
  function getMemberName(m: MemberWithUser) {
    return m.userName || m.user?.name || m.userId;
  }
  const riMembers = engagement.teamMembers.filter(m => m.role === 'RI') as MemberWithUser[];
  const managers = engagement.teamMembers.filter(m => m.role === 'Manager') as MemberWithUser[];
  const juniors = engagement.teamMembers.filter(m => m.role === 'Junior') as MemberWithUser[];

  const startedDate = engagement.startedAt ? new Date(engagement.startedAt).toLocaleDateString('en-GB') : null;
  const createdDate = new Date(engagement.createdAt).toLocaleDateString('en-GB');

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="grid grid-cols-3 gap-6">
        {/* Engagement Details */}
        <div className="bg-slate-50 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-200 pb-2">Engagement Details</h3>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Audit Type</dt>
              <dd className="font-medium text-slate-800">{AUDIT_TYPE_LABELS[auditType]}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Client</dt>
              <dd className="font-medium text-slate-800">{clientName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Period End</dt>
              <dd className="font-medium text-slate-800">{periodEndDate ? new Date(periodEndDate).toLocaleDateString('en-GB') : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  engagement.status === 'active' ? 'bg-green-100 text-green-700' :
                  engagement.status === 'review' ? 'bg-blue-100 text-blue-700' :
                  engagement.status === 'complete' ? 'bg-slate-100 text-slate-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {engagement.status === 'pre_start' ? 'SET UP' : engagement.status.toUpperCase()}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-700">{createdDate}</dd>
            </div>
            {startedDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Started</dt>
                <dd className="text-slate-700">{startedDate}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Info Request</dt>
              <dd className="font-medium text-slate-800 capitalize">{engagement.infoRequestType}</dd>
            </div>
            {engagement.hardCloseDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Hard Close</dt>
                <dd className="text-slate-700">{new Date(engagement.hardCloseDate).toLocaleDateString('en-GB')}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Client Contacts - editable */}
        <div>
          <ClientContactsPanel
            engagementId={engagement.id}
            initialContacts={engagement.contacts}
          />
        </div>

        {/* Team - editable */}
        <div>
          <TeamPanel
            engagementId={engagement.id}
            initialTeamMembers={engagement.teamMembers.map(m => ({
              id: m.id,
              userId: m.userId,
              role: m.role,
              userName: getMemberName(m as MemberWithUser),
              userEmail: m.userEmail || (m as MemberWithUser).user?.email,
            }))}
            initialSpecialists={engagement.specialists}
          />
        </div>
      </div>

      {/* Audit File Settings */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Audit File Settings</h3>
        <div className="grid grid-cols-2 gap-6">
          {/* Group Audit Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-700">Part of a Group Audit</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Enables Group Name column in Trial Balance and group-specific procedures
              </p>
            </div>
            <button
              onClick={() => {
                const newVal = !isGroupAudit;
                setIsGroupAudit(newVal);
                updateSetting('isGroupAudit', newVal);
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                isGroupAudit ? 'bg-blue-500' : 'bg-slate-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                isGroupAudit ? 'translate-x-5' : ''
              }`} />
            </button>
          </div>

          {/* Category Column Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-700">Show Category Column</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Display the Category column in the Trial Balance tab
              </p>
            </div>
            <button
              onClick={() => {
                const newVal = !showCategory;
                setShowCategory(newVal);
                // This is a UI preference, stored locally for now
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                showCategory ? 'bg-blue-500' : 'bg-slate-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                showCategory ? 'translate-x-5' : ''
              }`} />
            </button>
          </div>

          {/* Controls-based flag */}
          {(auditType === 'SME_CONTROLS' || auditType === 'PIE_CONTROLS') && (
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg col-span-2">
              <div>
                <p className="text-sm font-medium text-blue-700">Controls-Based Audit</p>
                <p className="text-xs text-blue-500 mt-0.5">
                  This is a controls-based audit. The RMM tab will include control testing columns and Risk Control assessments will be enabled.
                </p>
              </div>
              <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-1 rounded">Enabled</span>
            </div>
          )}
        </div>
      </div>

      {/* Information Requests Summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          Initial Information Request
          <span className="ml-2 text-xs font-normal text-slate-400 capitalize">({engagement.infoRequestType})</span>
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {engagement.informationRequests
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(req => {
              // isIncluded = requested, receivedAt would indicate received (future field)
              const received = (req as InfoRequestWithReceived).receivedAt;
              return (
                <div key={req.id} className="flex items-center gap-2 text-xs py-1">
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                    !req.isIncluded ? 'bg-slate-100 text-slate-400' :
                    received ? 'bg-green-100 text-green-600' :
                    'bg-orange-100 text-orange-600'
                  }`}>
                    {!req.isIncluded ? '—' : received ? '✓' : '○'}
                  </span>
                  <span className={req.isIncluded ? 'text-slate-700' : 'text-slate-400 line-through'}>{req.description}</span>
                  {req.isIncluded && !received && (
                    <span className="text-[10px] text-orange-500">Pending</span>
                  )}
                  {received && (
                    <span className="text-[10px] text-green-500">Received</span>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
