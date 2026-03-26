'use client';

import { useState, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search, Settings, Filter } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { ROLE_COLORS, type ResourceRole } from '@/lib/resource-planning/types';
import { computeStaffCapacity } from '@/lib/resource-planning/capacity';
import { StaffSettingsDialog } from './StaffSettingsDialog';
import { ViewSelector } from './ViewSelector';

interface Props {
  isResourceAdmin: boolean;
}

export function StaffPanel({ isResourceAdmin }: Props) {
  const staff = useResourcePlanningStore((s) => s.staff);
  const jobs = useResourcePlanningStore((s) => s.jobs);
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const visibleStart = useResourcePlanningStore((s) => s.visibleStart);
  const visibleEnd = useResourcePlanningStore((s) => s.visibleEnd);
  const selectedStaffIds = useResourcePlanningStore((s) => s.selectedStaffIds);
  const viewMode = useResourcePlanningStore((s) => s.viewMode);
  const leftPanelFilter = useResourcePlanningStore((s) => s.leftPanelFilter);
  const setLeftPanelFilter = useResourcePlanningStore((s) => s.setLeftPanelFilter);

  const [filter, setFilter] = useState('');
  const [settingsUserId, setSettingsUserId] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const isStaffAxis = viewMode.startsWith('staff');

  // Compute availability for staff view
  const availabilityMap = useMemo(() => {
    if (isStaffAxis) return new Map<string, boolean>();
    const caps = computeStaffCapacity(staff, allocations, new Date(visibleStart), new Date(visibleEnd));
    const map = new Map<string, boolean>();
    for (const c of caps) map.set(c.userId, c.netHrs > 0);
    return map;
  }, [staff, allocations, visibleStart, visibleEnd, isStaffAxis]);

  if (isStaffAxis) {
    // Show clients list when axis is staff
    const filteredClients = jobs.filter((j) => {
      if (selectedStaffIds.length > 0) return true; // Show all when staff filtered
      return j.clientName.toLowerCase().includes(filter.toLowerCase());
    });

    const uniqueClients = Array.from(new Map(filteredClients.map((j) => [j.clientId, j])).values());

    return (
      <div className="w-1/4 min-w-[180px] max-w-[280px] border-r bg-slate-50 flex flex-col overflow-hidden">
        <div className="p-2 border-b flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
            <input
              type="text"
              placeholder="Filter clients..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-6 pr-2 py-1 text-[10px] border rounded"
            />
          </div>
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={`p-1 rounded ${leftPanelFilter.length > 0 ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-400'}`}
          >
            <Filter className="h-3 w-3" />
          </button>
        </div>

        {showFilter && (
          <div className="p-1 border-b bg-white max-h-32 overflow-y-auto">
            {uniqueClients.map((c) => (
              <label key={c.clientId} className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] cursor-pointer hover:bg-slate-50 rounded">
                <input
                  type="checkbox"
                  checked={leftPanelFilter.includes(c.clientId)}
                  onChange={(e) => {
                    if (e.target.checked) setLeftPanelFilter([...leftPanelFilter, c.clientId]);
                    else setLeftPanelFilter(leftPanelFilter.filter((id) => id !== c.clientId));
                  }}
                  className="h-2.5 w-2.5"
                />
                {c.clientName}
              </label>
            ))}
            {leftPanelFilter.length > 0 && (
              <button onClick={() => setLeftPanelFilter([])} className="text-[9px] text-blue-600 px-1.5 mt-0.5">Clear all</button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {uniqueClients.map((client) => (
            <div key={client.clientId} className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-100 text-[10px]">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-700 truncate">{client.clientName}</div>
                <div className="text-slate-400">{client.auditType}</div>
              </div>
            </div>
          ))}
        </div>

        <ViewSelector />
      </div>
    );
  }

  // Default: staff list
  const filteredStaff = staff.filter((s) => {
    if (selectedStaffIds.length > 0) return selectedStaffIds.includes(s.id);
    return s.name.toLowerCase().includes(filter.toLowerCase());
  });

  return (
    <div className="w-1/4 min-w-[180px] max-w-[280px] border-r bg-slate-50 flex flex-col overflow-hidden">
      <div className="p-2 border-b flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
          <input
            type="text"
            placeholder="Filter staff..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-[10px] border rounded"
          />
        </div>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`p-1 rounded ${leftPanelFilter.length > 0 ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-400'}`}
        >
          <Filter className="h-3 w-3" />
        </button>
      </div>

      {showFilter && (
        <div className="p-1 border-b bg-white max-h-32 overflow-y-auto">
          {staff.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] cursor-pointer hover:bg-slate-50 rounded">
              <input
                type="checkbox"
                checked={leftPanelFilter.includes(s.id)}
                onChange={(e) => {
                  if (e.target.checked) setLeftPanelFilter([...leftPanelFilter, s.id]);
                  else setLeftPanelFilter(leftPanelFilter.filter((id) => id !== s.id));
                }}
                className="h-2.5 w-2.5"
              />
              {s.name}
            </label>
          ))}
          {leftPanelFilter.length > 0 && (
            <button onClick={() => setLeftPanelFilter([])} className="text-[9px] text-blue-600 px-1.5 mt-0.5">Clear all</button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filteredStaff.map((member) => (
          <StaffListItem
            key={member.id}
            member={member}
            isAvailable={availabilityMap.get(member.id) ?? false}
            isResourceAdmin={isResourceAdmin}
            onSettingsClick={() => setSettingsUserId(member.id)}
          />
        ))}
        {filteredStaff.length === 0 && (
          <div className="p-3 text-center text-[10px] text-slate-400">No staff found</div>
        )}
      </div>

      <ViewSelector />

      {settingsUserId && <StaffSettingsDialog userId={settingsUserId} onClose={() => setSettingsUserId(null)} />}
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `staff-${member.id}` });
  const role = member.resourceSetting?.resourceRole as ResourceRole | undefined;
  const colors = role ? ROLE_COLORS[role] : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1 border-b border-slate-100 cursor-grab hover:bg-white transition-colors group
        ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium text-slate-700 truncate">{member.name}</div>
        {role && colors && (
          <span className={`px-1 py-0 rounded text-[8px] font-medium ${colors.bg} ${colors.text}`}>{role}</span>
        )}
      </div>
      {isResourceAdmin && (
        <button
          onClick={(e) => { e.stopPropagation(); onSettingsClick(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 transition-opacity"
        >
          <Settings className="h-2.5 w-2.5 text-slate-400" />
        </button>
      )}
    </div>
  );
}
