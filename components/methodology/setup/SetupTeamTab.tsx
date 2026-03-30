'use client';

import { useState, useEffect } from 'react';
import type { TeamMemberData, SpecialistData } from '@/hooks/useEngagement';

interface FirmUser {
  id: string;
  name: string;
  email: string;
}

interface ResourceStaffMember {
  id: string;
  name: string;
  email: string;
  resourceSetting?: {
    resourceRole: string;
  } | null;
}

// Combined member for the setup team list
export interface SetupMember {
  userId: string;
  userName: string;
  userEmail: string;
  role: 'Junior' | 'Manager' | 'RI' | 'Specialist';
  specialistType?: 'Specialist' | 'Expert' | 'EthicsPartner' | 'TechnicalAdvisor';
}

const TEAM_ROLES = [
  { value: 'Junior', label: 'Preparer' },
  { value: 'Manager', label: 'Reviewer' },
  { value: 'RI', label: 'Partner' },
  { value: 'Specialist', label: 'Specialist' },
] as const;

const SPECIALIST_TYPES = [
  { type: 'Specialist', label: 'Specialist' },
  { type: 'Expert', label: 'Expert' },
  { type: 'EthicsPartner', label: 'Ethics Partner' },
  { type: 'TechnicalAdvisor', label: 'Technical Advisor' },
] as const;

interface Props {
  members: SetupMember[];
  onChange: (members: SetupMember[]) => void;
}

export function SetupTeamTab({ members, onChange }: Props) {
  const [source, setSource] = useState<'firm' | 'resource'>('firm');
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [resourceStaff, setResourceStaff] = useState<ResourceStaffMember[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  async function loadFirmUsers() {
    if (firmUsers.length > 0) return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setFirmUsers(data.users || data || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadResourceStaff() {
    if (resourceStaff.length > 0) return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/resource-planning/staff');
      if (res.ok) {
        const data = await res.json();
        setResourceStaff(data.staff || data || []);
      }
    } catch (err) {
      console.error('Failed to load resource staff:', err);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    if (showAdd) {
      if (source === 'firm') loadFirmUsers();
      else loadResourceStaff();
    }
  }, [showAdd, source]);

  function mapResourceRoleToTeamRole(resourceRole?: string): SetupMember['role'] {
    if (!resourceRole) return 'Junior';
    const lower = resourceRole.toLowerCase();
    if (lower === 'ri') return 'RI';
    if (lower === 'reviewer') return 'Manager';
    if (lower === 'specialist') return 'Specialist';
    return 'Junior';
  }

  function addMember(userId: string, name: string, email: string, defaultRole?: string) {
    if (members.some(m => m.userId === userId)) return;
    const role = defaultRole ? mapResourceRoleToTeamRole(defaultRole) : 'Junior';
    onChange([...members, {
      userId,
      userName: name,
      userEmail: email,
      role,
      specialistType: role === 'Specialist' ? 'Specialist' : undefined,
    }]);
    setShowAdd(false);
  }

  function updateRole(index: number, role: SetupMember['role']) {
    const updated = members.map((m, i) => {
      if (i !== index) return m;
      return {
        ...m,
        role,
        specialistType: role === 'Specialist' ? (m.specialistType || 'Specialist') : undefined,
      };
    });
    onChange(updated);
  }

  function updateSpecialistType(index: number, specialistType: SetupMember['specialistType']) {
    const updated = members.map((m, i) =>
      i === index ? { ...m, specialistType } : m
    );
    onChange(updated);
  }

  function removeMember(index: number) {
    onChange(members.filter((_, i) => i !== index));
  }

  const availableUsers = source === 'firm'
    ? firmUsers.filter(u => !members.some(m => m.userId === u.id))
    : resourceStaff.filter(u => !members.some(m => m.userId === u.id));

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800">Team Members</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 font-medium"
        >
          {showAdd ? 'Cancel' : '+ Add Member'}
        </button>
      </div>

      {/* Add member panel */}
      {showAdd && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          {/* Source toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => { setSource('firm'); loadFirmUsers(); }}
              className={`text-xs px-3 py-1.5 rounded-md font-medium ${
                source === 'firm'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              Firm Users
            </button>
            <button
              onClick={() => { setSource('resource'); loadResourceStaff(); }}
              className={`text-xs px-3 py-1.5 rounded-md font-medium ${
                source === 'resource'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              Resource Staff
            </button>
          </div>

          {/* User list */}
          <div className="max-h-40 overflow-auto border border-slate-200 rounded bg-white">
            {loadingUsers ? (
              <p className="text-xs text-slate-400 p-2 animate-pulse">Loading...</p>
            ) : availableUsers.length === 0 ? (
              <p className="text-xs text-slate-400 p-2">No available users</p>
            ) : (
              availableUsers.map((user) => {
                const resourceRole = 'resourceSetting' in user
                  ? (user as ResourceStaffMember).resourceSetting?.resourceRole
                  : undefined;
                return (
                  <button
                    key={user.id}
                    onClick={() => addMember(user.id, user.name, user.email, resourceRole)}
                    className="block w-full text-left text-xs px-3 py-1.5 hover:bg-blue-50 border-b border-slate-50 last:border-0"
                  >
                    <span className="font-medium text-slate-700">{user.name}</span>
                    <span className="text-slate-400 ml-1">({user.email})</span>
                    {resourceRole && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                        {resourceRole}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Members table */}
      {members.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          No team members added. Click "+ Add Member" to get started.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {members.map((member, i) => (
            <div key={member.userId} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-700 truncate block">{member.userName}</span>
                <span className="text-xs text-slate-400">{member.userEmail}</span>
              </div>

              {/* Role selector */}
              <select
                value={member.role}
                onChange={e => updateRole(i, e.target.value as SetupMember['role'])}
                className="border border-slate-200 rounded px-2 py-1 text-xs bg-white min-w-[100px]"
              >
                {TEAM_ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>

              {/* Specialist function selector */}
              {member.role === 'Specialist' && (
                <select
                  value={member.specialistType || 'Specialist'}
                  onChange={e => updateSpecialistType(i, e.target.value as SetupMember['specialistType'])}
                  className="border border-slate-200 rounded px-2 py-1 text-xs bg-white min-w-[120px]"
                >
                  {SPECIALIST_TYPES.map(st => (
                    <option key={st.type} value={st.type}>{st.label}</option>
                  ))}
                </select>
              )}

              <button
                onClick={() => removeMember(i)}
                className="text-red-400 hover:text-red-600 text-sm px-1"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200">
        <p className="text-[10px] text-slate-400">
          Team configured here will be applied when an engagement is created.
        </p>
      </div>
    </div>
  );
}
