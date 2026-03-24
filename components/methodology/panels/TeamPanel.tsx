'use client';

import { useState, useEffect } from 'react';
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
  { value: 'Junior', label: 'Operator' },
  { value: 'Manager', label: 'Reviewer' },
  { value: 'RI', label: 'Partner' },
] as const;
const SPECIALIST_TYPES = [
  { type: 'Specialist', label: 'Specialist' },
  { type: 'Expert', label: 'Expert' },
  { type: 'EthicsPartner', label: 'Ethics Partner' },
  { type: 'TechnicalAdvisor', label: 'Technical Advisor' },
] as const;

export function TeamPanel({ engagementId, initialTeamMembers, initialSpecialists, ethicsPartnerName }: Props) {
  const [teamMembers, setTeamMembers] = useState<TeamMemberData[]>(initialTeamMembers);
  const [specialists, setSpecialists] = useState<SpecialistData[]>(initialSpecialists);
  const [firmUsers, setFirmUsers] = useState<FirmUser[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddSpecialist, setShowAddSpecialist] = useState(false);

  useEffect(() => { setTeamMembers(initialTeamMembers); }, [initialTeamMembers]);
  useEffect(() => { setSpecialists(initialSpecialists); }, [initialSpecialists]);

  useAutoSave(
    `/api/engagements/${engagementId}/team`,
    { teamMembers: teamMembers.map(m => ({ id: m.id || undefined, userId: m.userId, role: m.role })), specialists },
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
      role: 'Junior', // stored as Junior internally, displayed as Operator
      userName: user.name,
      userEmail: user.email,
    }]);
    setShowAddMember(false);
  }

  function updateMemberRole(index: number, role: string) {
    setTeamMembers(prev => prev.map((m, i) => i === index ? { ...m, role: role as TeamMemberData['role'] } : m));
  }

  function removeMember(index: number) {
    setTeamMembers(prev => prev.filter((_, i) => i !== index));
  }

  function addSpecialist(type: string) {
    // Only one of each type
    if (specialists.some(s => s.specialistType === type)) return;
    setSpecialists(prev => [...prev, {
      id: '',
      name: type === 'EthicsPartner' && ethicsPartnerName ? ethicsPartnerName : '',
      email: '',
      specialistType: type as SpecialistData['specialistType'],
      firmName: '',
    }]);
    setShowAddSpecialist(false);
  }

  function updateSpecialist(index: number, field: keyof SpecialistData, value: string) {
    setSpecialists(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function removeSpecialist(index: number) {
    setSpecialists(prev => prev.filter((_, i) => i !== index));
  }

  const availableSpecialistTypes = SPECIALIST_TYPES.filter(
    st => !specialists.some(s => s.specialistType === st.type)
  );

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
            >
              {TEAM_ROLES.map(role => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
            <button onClick={() => removeMember(i)} className="text-red-400 hover:text-red-600 text-xs">×</button>
          </div>
        ))}
      </div>

      {/* Specialists Section */}
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
          <div className="mb-2 border border-slate-200 rounded p-2 bg-slate-50">
            {availableSpecialistTypes.map(st => (
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
          {specialists.map((spec, i) => (
            <div key={spec.id || `spec-${i}`} className="p-2 border border-slate-100 rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500">
                  {SPECIALIST_TYPES.find(st => st.type === spec.specialistType)?.label}
                </span>
                <button onClick={() => removeSpecialist(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
              </div>
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
