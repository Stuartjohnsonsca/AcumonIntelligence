'use client';

import { memo, useState, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { ROLE_COLORS, type ResourceRole, getStaffRoles } from '@/lib/resource-planning/types';
import { computeStaffCapacity } from '@/lib/resource-planning/capacity';
import { ViewSelector } from './ViewSelector';

interface Props {
  isResourceAdmin: boolean;
}

export function StaffPanel({ isResourceAdmin }: Props) {
  const { staff, jobs, allocations, visibleStart, visibleEnd, selectedStaffIds, viewMode, leftPanelFilter, currentUserId } =
    useResourcePlanningStore(useShallow((s) => ({
      staff: s.staff,
      jobs: s.jobs,
      allocations: s.allocations,
      visibleStart: s.visibleStart,
      visibleEnd: s.visibleEnd,
      selectedStaffIds: s.selectedStaffIds,
      viewMode: s.viewMode,
      leftPanelFilter: s.leftPanelFilter,
      currentUserId: s.currentUserId,
    })));
  const setLeftPanelFilter = useResourcePlanningStore((s) => s.setLeftPanelFilter);

  const [filter, setFilter] = useState('');

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
    const filteredClients = jobs.filter((j) =>
      j.clientName.toLowerCase().includes(filter.toLowerCase())
    );
    const uniqueClients = Array.from(new Map(filteredClients.map((j) => [j.clientId, j])).values());

    return (
      <div className="w-1/4 min-w-[180px] max-w-[280px] border-r bg-slate-50 flex flex-col overflow-hidden">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
            <input type="text" placeholder="Search clients..." value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-6 pr-2 py-1 text-[10px] border rounded" />
          </div>
        </div>

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

  // Staff list
  const [myScheduleOnly, setMyScheduleOnly] = useState(!isResourceAdmin);

  const filteredStaff = useMemo(() => {
    let result = staff;

    if (myScheduleOnly && currentUserId) {
      const myEngagements = new Set(
        allocations.filter((a) => a.userId === currentUserId).map((a) => a.engagementId),
      );
      const teamIds = new Set<string>();
      teamIds.add(currentUserId);
      for (const alloc of allocations) {
        if (myEngagements.has(alloc.engagementId)) teamIds.add(alloc.userId);
      }
      result = staff.filter((s) => teamIds.has(s.id));
    }

    if (selectedStaffIds.length > 0) {
      result = result.filter((s) => selectedStaffIds.includes(s.id));
    } else if (filter) {
      result = result.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));
    }
    return result;
  }, [staff, selectedStaffIds, filter, myScheduleOnly, currentUserId, allocations]);

  return (
    <div className="w-1/4 min-w-[180px] max-w-[280px] border-r bg-slate-50 flex flex-col overflow-hidden">
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
          <input type="text" placeholder="Search staff..." value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-[10px] border rounded" />
        </div>
        <button onClick={() => setMyScheduleOnly(!myScheduleOnly)}
          className={`mt-1 w-full py-0.5 text-[9px] font-medium rounded transition-colors
            ${myScheduleOnly ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          {myScheduleOnly ? '🔵 My Schedule' : 'Full Schedule'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredStaff.map((member) => (
          <StaffListItem key={member.id} member={member} allocations={allocations}
            isAvailable={availabilityMap.get(member.id) ?? false} />
        ))}
        {filteredStaff.length === 0 && (
          <div className="p-3 text-center text-[10px] text-slate-400">No staff found</div>
        )}
      </div>

      <ViewSelector />
    </div>
  );
}

const StaffListItem = memo(function StaffListItem({ member, allocations, isAvailable }: {
  member: { id: string; name: string; jobTitle: string | null; resourceSetting: any };
  allocations: any[];
  isAvailable: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `staff-${member.id}` });
  const roles = getStaffRoles(member.resourceSetting);

  const { jobCountByRole, weightedCapacity } = useMemo(() => {
    const userAllocs = allocations.filter((a: any) => a.userId === member.id);
    const byRole = new Map<string, Set<string>>();
    for (const alloc of userAllocs) {
      if (!byRole.has(alloc.role)) byRole.set(alloc.role, new Set());
      byRole.get(alloc.role)!.add(alloc.engagementId);
    }
    const counts = new Map<string, number>();
    for (const [role, engs] of byRole) counts.set(role, engs.size);

    const baseLimit = roles.find((r) => r.role === 'Preparer')?.limit ?? 3;
    let load = 0;
    for (const { role, limit } of roles) {
      const count = counts.get(role) ?? 0;
      const weight = baseLimit / limit;
      load += count * weight;
    }

    return { jobCountByRole: counts, weightedCapacity: Math.round(load * 10) / 10 };
  }, [allocations, member.id, roles]);

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-100 cursor-grab hover:bg-white transition-colors group
        ${isDragging ? 'opacity-50' : ''}`}>
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-700 truncate">{member.name}</span>
          <span className={`text-[8px] font-bold ${weightedCapacity >= 1 ? 'text-red-500' : 'text-green-600'}`} title="Preparer Job Equivalents">
            {weightedCapacity > 0 ? `${weightedCapacity}u` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-0.5 mt-0.5">
          {roles.map(({ role, limit }) => {
            const colors = ROLE_COLORS[role];
            const count = jobCountByRole.get(role) ?? 0;
            const atLimit = count >= limit;
            return (
              <span key={role}
                className={`inline-flex items-center gap-0.5 px-1 py-0 rounded text-[7px] font-medium ${colors.bg} ${colors.text}`}>
                {role}
                <span className={`${atLimit ? 'text-red-600 font-bold' : ''}`}>{count}/{limit}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
});
