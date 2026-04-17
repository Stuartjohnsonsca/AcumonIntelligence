'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { useSession } from 'next-auth/react';

interface SignOff {
  userId: string;
  userName: string;
  timestamp: string;
}

interface SignOffs {
  operator?: SignOff;
  reviewer?: SignOff;
  partner?: SignOff;
}

interface FieldMeta {
  lastEditedAt?: string;
  lastEditedBy?: string;
}

interface TeamMember {
  userId: string;
  userName?: string;
  role: string;
}

// Context so child components can access sign-off state and track edits
interface SignOffContextValue {
  signOffs: SignOffs;
  fieldMeta: Record<string, FieldMeta>;
  trackFieldEdit: (fieldId: string) => void;
  getFieldOutline: (fieldId: string) => string;
}

const SignOffContext = createContext<SignOffContextValue>({
  signOffs: {},
  fieldMeta: {},
  trackFieldEdit: () => {},
  getFieldOutline: () => '',
});

export function useSignOff() {
  return useContext(SignOffContext);
}

// Map team roles to sign-off roles
const ROLE_MAP: Record<string, string> = { Junior: 'operator', Manager: 'reviewer', RI: 'partner' };

const SIGN_OFF_ROLES = [
  { key: 'operator' as const, label: 'Preparer' },
  { key: 'reviewer' as const, label: 'Reviewer' },
  { key: 'partner' as const, label: 'Partner' },
];

/**
 * Cascade sign-off visuals downwards: if Partner has signed, Reviewer and
 * Preparer dots render as signed too (using the Partner's identity and
 * timestamp). If Reviewer has signed, Preparer renders as signed. The
 * cascade only affects the visual representation — the stored sign-off
 * records for each role are unchanged. This reflects the real-world
 * principle that a higher authority's sign-off implies (and subsumes)
 * the lower authorities' review.
 */
function effectiveSignOff(
  role: 'operator' | 'reviewer' | 'partner',
  signOffs: SignOffs,
): { signOff: SignOff | undefined; viaRole: 'operator' | 'reviewer' | 'partner' | null } {
  if (role === 'partner') {
    return { signOff: signOffs.partner, viaRole: signOffs.partner?.timestamp ? 'partner' : null };
  }
  if (role === 'reviewer') {
    if (signOffs.reviewer?.timestamp) return { signOff: signOffs.reviewer, viaRole: 'reviewer' };
    if (signOffs.partner?.timestamp) return { signOff: signOffs.partner, viaRole: 'partner' };
    return { signOff: undefined, viaRole: null };
  }
  // operator — cascade from reviewer, then from partner
  if (signOffs.operator?.timestamp) return { signOff: signOffs.operator, viaRole: 'operator' };
  if (signOffs.reviewer?.timestamp) return { signOff: signOffs.reviewer, viaRole: 'reviewer' };
  if (signOffs.partner?.timestamp) return { signOff: signOffs.partner, viaRole: 'partner' };
  return { signOff: undefined, viaRole: null };
}

interface Props {
  engagementId: string;
  endpoint: string; // API endpoint for this tab's sign-offs
  title: string;
  teamMembers: TeamMember[];
  children: React.ReactNode;
  savingStatus?: { saving: boolean; lastSaved: Date | null; error?: string | null };
  headerActions?: React.ReactNode; // Custom buttons to the left of sign-off dots
  /**
   * Fires whenever a sign-off toggle completes successfully. Parents that
   * render their own derivative sign-off indicators (e.g. the small
   * Reviewer/RI dots on the tab-bar labels in EngagementTabs) use this to
   * update their summary state immediately instead of waiting for the next
   * tab switch. The callback receives the full updated SignOffs payload
   * returned by the server.
   */
  onSignOffChange?: (signOffs: SignOffs) => void;
}

export function SignOffHeader({ engagementId, endpoint, title, teamMembers, children, savingStatus, headerActions, onSignOffChange }: Props) {
  const { data: session } = useSession();
  const [signOffs, setSignOffs] = useState<SignOffs>({});
  const [fieldMeta, setFieldMeta] = useState<Record<string, FieldMeta>>({});

  const loadSignOffs = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/${endpoint}?meta=signoffs`);
      if (res.ok) {
        const json = await res.json();
        if (json.signOffs) setSignOffs(json.signOffs);
        if (json.fieldMeta) setFieldMeta(json.fieldMeta);
      }
    } catch { /* ignore */ }
  }, [engagementId, endpoint]);

  useEffect(() => { loadSignOffs(); }, [loadSignOffs]);

  function trackFieldEdit(fieldId: string) {
    setFieldMeta(prev => ({
      ...prev,
      [fieldId]: {
        lastEditedAt: new Date().toISOString(),
        lastEditedBy: session?.user?.id || '',
      },
    }));
  }

  function getFieldOutline(fieldId: string): string {
    const meta = fieldMeta[fieldId];
    if (!meta?.lastEditedAt) return '';
    const editTime = new Date(meta.lastEditedAt).getTime();
    const reviewerTime = signOffs.reviewer?.timestamp ? new Date(signOffs.reviewer.timestamp).getTime() : 0;
    const partnerTime = signOffs.partner?.timestamp ? new Date(signOffs.partner.timestamp).getTime() : 0;
    const changedSincePartner = partnerTime > 0 && editTime > partnerTime;
    const changedSinceReviewer = reviewerTime > 0 && editTime > reviewerTime;
    if (changedSincePartner) return 'ring-2 ring-red-400 ring-offset-1';
    if (changedSinceReviewer) return 'ring-2 ring-orange-400 ring-offset-1';
    return '';
  }

  function isSignOffStale(role: 'operator' | 'reviewer' | 'partner'): boolean {
    // Use the effective sign-off (cascaded where applicable) so a cascaded
    // dot can still show the stale ring when edits happened after the
    // higher-authority sign-off that triggered the cascade.
    const { signOff } = effectiveSignOff(role, signOffs);
    if (!signOff?.timestamp) return false;
    const signOffTime = new Date(signOff.timestamp).getTime();
    return Object.values(fieldMeta).some(meta => {
      if (!meta.lastEditedAt) return false;
      return new Date(meta.lastEditedAt).getTime() > signOffTime;
    });
  }

  async function handleSignOff(role: 'operator' | 'reviewer' | 'partner') {
    // Toggle: if user already signed this role, unsign it
    const existing = signOffs[role];
    const isUnsigning = existing?.userId === session?.user?.id;

    try {
      const res = await fetch(`/api/engagements/${engagementId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isUnsigning ? 'unsignoff' : 'signoff', role }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.signOffs) {
          setSignOffs(json.signOffs);
          // Notify the parent (EngagementTabs) so the tab-label dots can
          // update immediately, rather than waiting for the next tab switch.
          onSignOffChange?.(json.signOffs);
        }
      }
    } catch (err) {
      console.error('Sign-off failed:', err);
    }
  }

  // Save field meta when it changes (debounced via parent's auto-save)
  useEffect(() => {
    if (Object.keys(fieldMeta).length === 0) return;
    const timeout = setTimeout(async () => {
      try {
        await fetch(`/api/engagements/${engagementId}/${endpoint}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fieldMeta }),
        });
      } catch { /* ignore */ }
    }, 2000);
    return () => clearTimeout(timeout);
  }, [fieldMeta, engagementId, endpoint]);

  const contextValue: SignOffContextValue = { signOffs, fieldMeta, trackFieldEdit, getFieldOutline };

  return (
    <SignOffContext.Provider value={contextValue}>
      <div className="flex flex-col h-full">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 pb-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-800">{title}</h2>
              {savingStatus && (
                <div className="flex items-center gap-2 text-xs">
                  {savingStatus.saving && <span className="text-blue-500 animate-pulse">Saving...</span>}
                  {savingStatus.lastSaved && !savingStatus.saving && <span className="text-green-500">Saved {savingStatus.lastSaved.toLocaleTimeString()}</span>}
                  {savingStatus.error && <span className="text-red-500">{savingStatus.error}</span>}
                </div>
              )}
            </div>

            {/* Custom header actions */}
            {headerActions}

            {/* Sign-off dots */}
            <div className="flex items-center gap-5">
              {SIGN_OFF_ROLES.map(({ key, label }) => {
                // Cascaded sign-off: Partner implies Reviewer + Preparer;
                // Reviewer implies Preparer. `viaRole` tells us whether
                // this role was signed directly or inherited from above.
                const { signOff: effective, viaRole } = effectiveSignOff(key, signOffs);
                const isStale = isSignOffStale(key);
                const hasSigned = !!effective?.timestamp;
                const isCascaded = hasSigned && viaRole !== key;
                const showGreen = hasSigned && !isStale;
                const currentUserId = session?.user?.id;
                const canSign = currentUserId && teamMembers.some(m => ROLE_MAP[m.role] === key && m.userId === currentUserId);
                // For cascaded dots we let the user still sign their own
                // row if they hold the role — it's a no-op visually but
                // records their actual sign-off against their own user.
                const titleBase = hasSigned
                  ? isCascaded
                    ? `${effective!.userName} — ${new Date(effective!.timestamp).toLocaleString()} (signed as ${viaRole === 'partner' ? 'Partner' : viaRole === 'reviewer' ? 'Reviewer' : 'Preparer'})`
                    : `${effective!.userName} — ${new Date(effective!.timestamp).toLocaleString()}`
                  : canSign
                    ? `Click to sign off as ${label}`
                    : `Only ${label}s can sign off here`;

                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-slate-500 font-medium">{label}</span>
                    <button
                      onClick={() => canSign && handleSignOff(key)}
                      disabled={!canSign}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                        showGreen
                          ? 'bg-green-500 border-green-500'
                          : isStale
                            ? 'bg-white border-green-500'
                            : canSign
                              ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                              : 'bg-white border-slate-200 cursor-not-allowed opacity-50'
                      }`}
                      title={titleBase}
                    />
                    {hasSigned && (
                      <div className="text-center">
                        <p className="text-[9px] text-slate-600 leading-tight">{effective!.userName}</p>
                        <p className="text-[8px] text-slate-400">{new Date(effective!.timestamp).toLocaleDateString('en-GB')}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </SignOffContext.Provider>
  );
}
