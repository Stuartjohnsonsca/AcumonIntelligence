'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search, Settings } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { ROLE_COLORS, type ResourceRole } from '@/lib/resource-planning/types';
import { StaffSettingsDialog } from './StaffSettingsDialog';

interface Props {
  isResourceAdmin: boolean;
}

export function StaffPanel({ isResourceAdmin }: Props) {
  const staff = useResourcePlanningStore((s) => s.staff);
  const getStaffAvailability = useResourcePlanningStore((s) => s.getStaffAvailability);
  const selectedStaffIds = useResourcePlanningStore((s) => s.selectedStaffIds);
  const [filter, setFilter] = useState('');
  const [settingsUserId, setSettingsUserId] = useState<string | null>(null);

  const filteredStaff = staff.filter((s) => {
    if (selectedStaffIds.length > 0) {
      return selectedStaffIds.includes(s.id);
    }
    return s.name.toLowerCase().includes(filter.toLowerCase());
  });

  return (
    <div className="w-1/4 min-w-[200px] max-w-[320px] border-r bg-slate-50 flex flex-col overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Filter staff..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-xs border rounded-md"
          />
        </div>
      </div>

      {/* Staff List */}
      <div className="flex-1 overflow-y-auto">
        {filteredStaff.map((member) => (
          <StaffListItem
            key={member.id}
            member={member}
            isAvailable={getStaffAvailability(member.id)}
            isResourceAdmin={isResourceAdmin}
            onSettingsClick={() => setSettingsUserId(member.id)}
          />
        ))}
        {filteredStaff.length === 0 && (
          <div className="p-4 text-center text-xs text-slate-400">No staff found</div>
        )}
      </div>

      {/* Settings Dialog */}
      {settingsUserId && (
        <StaffSettingsDialog
          userId={settingsUserId}
          onClose={() => setSettingsUserId(null)}
        />
      )}
    </div>
  );
}

function StaffListItem({
  member,
  isAvailable,
  isResourceAdmin,
  onSettingsClick,
}: {
  member: { id: string; name: string; jobTitle: string | null; resourceSetting: any };
  isAvailable: boolean;
  isResourceAdmin: boolean;
  onSettingsClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `staff-${member.id}`,
  });

  const role = member.resourceSetting?.resourceRole as ResourceRole | undefined;
  const colors = role ? ROLE_COLORS[role] : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        flex items-center gap-2 px-3 py-2 border-b border-slate-100 cursor-grab
        hover:bg-white transition-colors group
        ${isDragging ? 'opacity-50' : ''}
      `}
    >
      {/* Availability dot */}
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isAvailable ? 'bg-green-500' : 'bg-red-500'
        }`}
      />

      {/* Name + role */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-slate-700 truncate">{member.name}</div>
        <div className="flex items-center gap-1">
          {role && colors && (
            <span className={`px-1.5 py-0 rounded text-[10px] font-medium ${colors.bg} ${colors.text}`}>
              {role}
            </span>
          )}
          {member.jobTitle && (
            <span className="text-[10px] text-slate-400 truncate">{member.jobTitle}</span>
          )}
        </div>
      </div>

      {/* Settings button */}
      {isResourceAdmin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSettingsClick();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 transition-opacity"
        >
          <Settings className="h-3 w-3 text-slate-400" />
        </button>
      )}
    </div>
  );
}
