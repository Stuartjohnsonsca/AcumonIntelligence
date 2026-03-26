'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';

export function ResourceToolbar() {
  const staff = useResourcePlanningStore((s) => s.staff);
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const getStaffCapacity = useResourcePlanningStore((s) => s.getStaffCapacity);
  const selectedStaffIds = useResourcePlanningStore((s) => s.selectedStaffIds);
  const setSelectedStaff = useResourcePlanningStore((s) => s.setSelectedStaff);
  const searchQuery = useResourcePlanningStore((s) => s.searchQuery);
  const setSearchQuery = useResourcePlanningStore((s) => s.setSearchQuery);

  const [searchOpen, setSearchOpen] = useState(false);

  const capacity = useMemo(() => getStaffCapacity(), [getStaffCapacity, staff, allocations]);

  const positive = capacity.filter((c) => c.netHrs > 0).sort((a, b) => b.netHrs - a.netHrs);
  const negative = capacity.filter((c) => c.netHrs < 0).sort((a, b) => a.netHrs - b.netHrs);

  const filteredStaff = staff.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  function toggleStaffSelection(id: string) {
    if (selectedStaffIds.includes(id)) {
      setSelectedStaff(selectedStaffIds.filter((sid) => sid !== id));
    } else {
      setSelectedStaff([...selectedStaffIds, id]);
    }
  }

  return (
    <div className="sticky top-16 z-30 bg-white border-b shadow-sm px-4 py-2">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Positive capacity */}
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto min-w-0">
          {positive.map((c) => (
            <span
              key={c.userId}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200 whitespace-nowrap flex-shrink-0"
            >
              {c.name.split(' ')[0]}
              <span className="font-semibold">+{c.netHrs}h</span>
            </span>
          ))}
          {positive.length === 0 && (
            <span className="text-xs text-slate-400">No spare capacity</span>
          )}
        </div>

        {/* Center: Search */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
          >
            <Search className="h-4 w-4" />
          </button>
          {searchOpen && (
            <div className="absolute top-full right-0 mt-1 w-64 bg-white border rounded-lg shadow-lg z-40 p-2">
              <input
                type="text"
                placeholder="Search staff..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-2 py-1 text-sm border rounded mb-1"
                autoFocus
              />
              <div className="max-h-48 overflow-y-auto">
                {filteredStaff.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStaffIds.includes(s.id)}
                      onChange={() => toggleStaffSelection(s.id)}
                      className="rounded"
                    />
                    <span>{s.name}</span>
                    {s.resourceSetting && (
                      <span className="text-xs text-slate-400">
                        {capacity.find((c) => c.userId === s.id)?.jobCount ?? 0} jobs
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {selectedStaffIds.length > 0 && (
                <button
                  onClick={() => setSelectedStaff([])}
                  className="mt-1 text-xs text-blue-600 hover:underline"
                >
                  Clear selection
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Negative capacity */}
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto min-w-0 justify-end">
          {negative.map((c) => (
            <span
              key={c.userId}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 whitespace-nowrap flex-shrink-0"
            >
              {c.name.split(' ')[0]}
              <span className="font-semibold">{c.netHrs}h</span>
            </span>
          ))}
          {negative.length === 0 && (
            <span className="text-xs text-slate-400">No overallocation</span>
          )}
        </div>
      </div>
    </div>
  );
}
