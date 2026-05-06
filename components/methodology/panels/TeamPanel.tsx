'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import type { TeamMemberData, SpecialistData } from '@/hooks/useEngagement';
import { useAutoSave } from '@/hooks/useAutoSave';

interface FirmUser {
  id: string;
  name: string;
  email: string;
}

interface Props {
  engagementId: string;
  initialTeamMembers: TeamMemberData[];
  initialSpecialists: SpecialistData[];
  ethicsPartnerName?: string;
}

const TEAM_ROLES = [
  { value: 'Junior', label: 'Preparer' },
  { value: 'Manager', label: 'Reviewer' },
  { value: 'RI', label: 'Partner' },
  { value: 'EQR', label: 'EQR' },
] as const;

// Regulatory Reviewer is methodology-admin-only — added separately to
// keep the standard role list focused on day-to-day engagement work.
// The role grants unlimited READ access to one engagement and is
// blocked from every write route via assertEngagementWriteAccess.
const REGULATORY_REVIEWER_ROLE = { value: 'RegulatoryReviewer', label: 'Regulatory Reviewer (read-only)' } as const;

// A specialist role and its assignable people, sourced from
// /api/methodology-admin/specialist-roles. The list loads on mount
// so the auditor can pick a role + a specific person from the
// firm's configured roster instead of typing names by hand.
interface SpecialistRoleOption {
  key: string;
  label: string;
  isAuditRole?: boolean;
  isActive?: boolean;
  // Lead person (always option 0).
  name: string;
  email: string;
  // Additional members beyond the lead.
  members?: { name: string; email: string }[];
}

export function TeamPanel({ engagementId, initialTeamMembers, initialSpecialists, ethicsPartnerName }: Props) {
  const { data: session } = useSession();
  // Methodology admins / super admins can attach a Regulatory Reviewer
  // to this engagement. The role appears in the role select for those
  // users only — everyone else sees the standard four roles.
  const canManageRegulatoryReviewer = Boolean(
    (session?.user as any)?.isSuperAdmin || (session?.user as any)?.isMethodologyAdmin,
  );
  const availableRoles = canManageRegulatoryReviewer
    ? [...TEAM_ROLES, REGULATORY_REVIEWER_ROLE]
    : TEAM_ROLES;

  const [teamMembers, setTeamMembers] = useState<TeamMemberData[]>(initialTeamMembers);
  const [specialists, setSpecialists] = useState<SpecialistData[]>(initialSpecialists);
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddSpecialist, setShowAddSpecialist] = useState(false);
  // Firm-configured specialist roles. We use `isAuditRole && isActive`
  // to filter — firm-global roles like ACP / Management Board are
  // hidden from the engagement picker per the methodology admin's
  // toggle. Falls back to an empty array if the API can't be
  // reached, in which case the picker just shows "no roles".
  const [roleOptions, setRoleOptions] = useState<SpecialistRoleOption[]>([]);

  useEffect(() => { setTeamMembers(initialTeamMembers); }, [initialTeamMembers]);
  useEffect(() => { setSpecialists(initialSpecialists); }, [initialSpecialists]);

  // Load specialist roles on mount. The endpoint is admin-tooling
  // but the GET only requires twoFactorVerified, so engagement
  // members can read it.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/methodology-admin/specialist-roles');
        if (!res.ok) return;
        const data = await res.json();
        const list: SpecialistRoleOption[] = Array.isArray(data?.roles) ? data.roles : [];
        setRoleOptions(list.filter(r => r.isActive !== false && r.isAuditRole !== false));
      } catch { /* tolerant */ }
    })();
  }, []);

  useAutoSave(
    `/api/engagements/${engagementId}/team`,
    {
      teamMembers: teamMembers.map((m, i) => ({
        id: m.id || undefined,
        userId: m.userId,
        role: m.role,
        // Persist auditor-controlled order. Server uses this to set
        // sort_order on each row, which template-context's
        // `{{#each team}}` reads via the sortOrder ORDER BY clause.
        sortOrder: i,
        // Free-text override for client-facing role label. Server
        // trims and normalises empty → null so the template-context
        // fallback to the system map (Junior→Preparer etc.) kicks in.
        roleLabel: m.roleLabel ?? null,
      })),
      specialists,
    },
    { enabled: teamMembers !== initialTeamMembers || specialists !== initialSpecialists }
  );

  async function loadFirmUsers() {
    if (firmUsers.length > 0) return;
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setFirmUsers(data.users || data || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  function addTeamMember(userId: string, user: FirmUser) {
    if (teamMembers.some(m => m.userId === userId)) return;
    setTeamMembers(prev => [...prev, {
      id: '',
      userId,
      role: 'Junior', // stored as Junior internally, displayed as Preparer
      userName: user.name,
      userEmail: user.email,
    }]);
    setShowAddMember(false);
  }

  function updateMemberRole(index: number, role: string) {
    setTeamMembers(prev => prev.map((m, i) => i === index ? { ...m, role: role as TeamMemberData['role'] } : m));
  }

  /** Update the free-text role-label override for a single team member.
   *  Stored as-is (no trimming) so the user can type spaces while
   *  composing — the server normalises empty → null on save. */
  function updateMemberRoleLabel(index: number, roleLabel: string) {
    setTeamMembers(prev => prev.map((m, i) => i === index ? { ...m, roleLabel } : m));
  }

  function removeMember(index: number) {
    setTeamMembers(prev => prev.filter((_, i) => i !== index));
  }

  /** Swap a member with the one above them. The autosave wrapper
   *  picks up the new array order on the next debounce and persists
   *  the new sortOrder values. Document templates that iterate
   *  `{{#each team}}` immediately reflect the new order. */
  function moveMemberUp(index: number) {
    if (index <= 0) return;
    setTeamMembers(prev => {
      const next = prev.slice();
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  // People available for a given role — Lead first, members after.
  // The engagement picker exposes one of these per chosen role.
  function peopleForRole(roleKey: string): { name: string; email: string }[] {
    const role = roleOptions.find(r => r.key === roleKey);
    if (!role) return [];
    const lead = role.name || role.email
      ? [{ name: role.name || '', email: role.email || '' }]
      : [];
    const members = (role.members || []).filter(m => m.name || m.email);
    return [...lead, ...members];
  }

  function addSpecialist(roleKey: string) {
    // Only one entry per role on an engagement; the dropdown still
    // lets the team swap who's assigned without re-adding the row.
    if (specialists.some(s => s.specialistType === roleKey)) return;
    const people = peopleForRole(roleKey);
    const seed = people[0] || { name: '', email: '' };
    setSpecialists(prev => [...prev, {
      id: '',
      name: seed.name,
      email: seed.email,
      specialistType: roleKey,
      firmName: '',
    }]);
    setShowAddSpecialist(false);
  }

  function updateSpecialist(index: number, field: keyof SpecialistData, value: string) {
    setSpecialists(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  // Set the assigned person for a specialist row by picking from
  // the role's `[lead, ...members]` list. The role key is encoded
  // as `<name>|<email>` in the option value so we can disambiguate
  // people who share a name.
  function pickSpecialistPerson(index: number, comboValue: string) {
    const [name, email] = comboValue.split('|');
    setSpecialists(prev => prev.map((s, i) => i === index ? { ...s, name: name || '', email: email || '' } : s));
  }

  function removeSpecialist(index: number) {
    setSpecialists(prev => prev.filter((_, i) => i !== index));
  }

  // Roles the auditor can still add to this engagement — exclude
  // any whose key already has a row.
  const availableSpecialistTypes = roleOptions
    .filter(r => !specialists.some(s => s.specialistType === r.key))
    .map(r => ({ type: r.key, label: r.label }));

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Team</h3>
        <button
          onClick={() => { setShowAddMember(true); loadFirmUsers(); }}
          className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
        >
          + Add Member
        </button>
      </div>

      {/* Add Member Dropdown */}
      {showAddMember && (
        <div className="mb-3 border border-slate-200 rounded p-2 bg-slate-50 max-h-40 overflow-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-600">Select User:</span>
            <button onClick={() => setShowAddMember(false)} className="text-xs text-slate-400 hover:text-slate-600">Close</button>
          </div>
          {firmUsers.length === 0 ? (
            <p className="text-xs text-slate-400 animate-pulse">Loading users...</p>
          ) : (
            firmUsers
              .filter(u => !teamMembers.some(m => m.userId === u.id))
              .map(user => (
                <button
                  key={user.id}
                  onClick={() => addTeamMember(user.id, user)}
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-blue-50 rounded"
                >
                  {user.name} <span className="text-slate-400">({user.email})</span>
                </button>
              ))
          )}
        </div>
      )}

      {/* Team Members */}
      <div className="space-y-1 mb-4 max-h-[200px] overflow-auto">
        {teamMembers.length === 0 && <p className="text-xs text-slate-400 italic">No team members added</p>}
        {teamMembers.map((member, i) => (
          <div key={member.id || `new-${i}`} className="flex items-center justify-between gap-2 py-1 px-2 bg-slate-50 rounded">
            <span className="text-xs text-slate-700 truncate flex-1">{member.userName || member.userId}</span>
            <select
              value={member.role}
              onChange={e => updateMemberRole(i, e.target.value)}
              className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white"
              title="System role — drives Reviewer/Partner sign-offs and EQR/RI rules"
            >
              {availableRoles.map(role => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
            {/* Free-text role label override. Empty = falls back to the
                system label (Preparer / Reviewer / Partner / EQR) when
                rendered in document templates. The select above still
                drives all system behaviour. Placeholder shows the
                fallback value so admins can see what the doc will say
                if they leave it blank. */}
            <input
              type="text"
              value={member.roleLabel ?? ''}
              onChange={e => updateMemberRoleLabel(i, e.target.value)}
              placeholder={availableRoles.find(r => r.value === member.role)?.label || ''}
              title="Custom label shown on client-facing documents (leave blank to use the system default)"
              className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white w-24"
            />
            {/* Move-up arrow. Disabled on the top row (nowhere to go).
                Document templates that iterate `{{#each team}}` use
                this order, so admins use it to control which RI /
                Manager / Preparer appears first in generated docs. */}
            <button
              type="button"
              onClick={() => moveMemberUp(i)}
              disabled={i === 0}
              title={i === 0 ? 'Already at the top' : 'Move up'}
              className="text-slate-400 hover:text-slate-700 text-xs disabled:opacity-30 disabled:cursor-not-allowed leading-none"
            >▲</button>
            <button
              type="button"
              onClick={() => removeMember(i)}
              title="Remove from team"
              className="text-red-400 hover:text-red-600 text-xs"
            >×</button>
          </div>
        ))}
      </div>

      {/* Specialists Section — roles + people sourced from
          Methodology Admin → Specialist Roles. Each row is one
          role; the dropdown lets the auditor pick the specific
          person ([Lead, ...members]) without typing names by
          hand. Roles whose `isAuditRole` is false (e.g. ACP /
          Management Board) don't appear here — they're firm-
          global, not per-engagement. */}
      <div className="border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-600">Specialists</span>
          {availableSpecialistTypes.length > 0 && (
            <button
              onClick={() => setShowAddSpecialist(!showAddSpecialist)}
              className="text-xs px-2 py-0.5 bg-slate-50 text-slate-600 rounded hover:bg-slate-100"
            >
              + Add
            </button>
          )}
        </div>

        {showAddSpecialist && (
          <div className="mb-2 border border-slate-200 rounded p-2 bg-slate-50 max-h-44 overflow-auto">
            {availableSpecialistTypes.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic px-1 py-0.5">
                No more roles to add. Configure roles in Methodology Admin → Specialist Roles.
              </p>
            ) : availableSpecialistTypes.map(st => (
              <button
                key={st.type}
                onClick={() => addSpecialist(st.type)}
                className="block w-full text-left text-xs px-2 py-1 hover:bg-blue-50 rounded"
              >
                {st.label}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {specialists.length === 0 && (
            <p className="text-[11px] text-slate-400 italic">No specialists assigned yet.</p>
          )}
          {specialists.map((spec, i) => {
            // Resolve the role's display label + pickable people.
            // Falls back to the raw key if the role's been removed
            // from Methodology Admin since this engagement was
            // saved (so old assignments stay editable).
            const role = roleOptions.find(r => r.key === spec.specialistType);
            const people = peopleForRole(spec.specialistType);
            const currentValue = `${spec.name || ''}|${spec.email || ''}`;
            const currentInList = people.some(p => `${p.name}|${p.email}` === currentValue);
            return (
              <div key={spec.id || `spec-${i}`} className="p-2 border border-slate-100 rounded">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-500">
                    {role?.label || spec.specialistType}
                  </span>
                  <button onClick={() => removeSpecialist(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                </div>
                {people.length > 0 ? (
                  <select
                    value={currentValue}
                    onChange={e => pickSpecialistPerson(i, e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs bg-white"
                    title="Pick from the firm's configured people for this role"
                  >
                    {!currentInList && currentValue !== '|' && (
                      <option value={currentValue}>
                        {spec.name || '(no name)'}{spec.email ? ` — ${spec.email}` : ''} (off-list)
                      </option>
                    )}
                    {people.map((p, idx) => (
                      <option key={idx} value={`${p.name}|${p.email}`}>
                        {p.name || '(no name)'}{p.email ? ` — ${p.email}` : ''}{idx === 0 ? ' · Lead' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  // Role exists but no Lead / members configured —
                  // keep the legacy free-text inputs as a fallback so
                  // the auditor isn't blocked. The Methodology Admin
                  // can fill in the roster later.
                  <div className="grid grid-cols-2 gap-1">
                    <input
                      type="text"
                      value={spec.name}
                      onChange={e => updateSpecialist(i, 'name', e.target.value)}
                      placeholder="Name"
                      className="border border-slate-200 rounded px-2 py-0.5 text-xs"
                    />
                    <input
                      type="email"
                      value={spec.email || ''}
                      onChange={e => updateSpecialist(i, 'email', e.target.value)}
                      placeholder="Email"
                      className="border border-slate-200 rounded px-2 py-0.5 text-xs"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
