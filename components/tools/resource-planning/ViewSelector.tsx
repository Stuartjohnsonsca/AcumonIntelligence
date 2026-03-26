'use client';

import { Plus, Minus } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ViewMode, EditMode } from '@/lib/resource-planning/types';

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'client-bookings', label: 'Client Bookings' },
  { value: 'staff-bookings', label: 'Staff Bookings' },
  { value: 'client-availability', label: 'Client Availability' },
  { value: 'staff-availability', label: 'Staff Availability' },
];

export function ViewSelector() {
  const viewMode = useResourcePlanningStore((s) => s.viewMode);
  const setViewMode = useResourcePlanningStore((s) => s.setViewMode);
  const editMode = useResourcePlanningStore((s) => s.editMode);
  const setEditMode = useResourcePlanningStore((s) => s.setEditMode);
  const selectedAllocationId = useResourcePlanningStore((s) => s.selectedAllocationId);
  const removeAllocation = useResourcePlanningStore((s) => s.removeAllocation);

  async function handleAdd() {
    // Create a placeholder allocation - user will drag to position
    setEditMode('create');
  }

  async function handleRemove() {
    if (!selectedAllocationId) return;
    // Optimistic remove
    removeAllocation(selectedAllocationId);
    // API call
    try {
      await fetch(`/api/resource-planning/allocations/${selectedAllocationId}`, { method: 'DELETE' });
    } catch {
      // Revert on failure handled by re-fetch
    }
  }

  return (
    <div className="border-t bg-slate-50 p-2 flex-shrink-0">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">View</div>

      {/* View mode radio buttons */}
      <div className="space-y-0.5">
        {VIEW_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer text-[10px]
              ${viewMode === opt.value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <input
              type="radio"
              name="viewMode"
              value={opt.value}
              checked={viewMode === opt.value}
              onChange={() => setViewMode(opt.value)}
              className="h-2.5 w-2.5"
            />
            {opt.label}
          </label>
        ))}
      </div>

      {/* Drag mode toggle */}
      <div className="mt-2 pt-2 border-t border-slate-200">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Drag Mode</div>
        <div className="flex rounded-md overflow-hidden border border-slate-200">
          <button
            onClick={() => setEditMode('edit')}
            className={`flex-1 py-1 text-[10px] font-medium transition-colors
              ${editMode === 'edit' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Edit
          </button>
          <button
            onClick={() => setEditMode('create')}
            className={`flex-1 py-1 text-[10px] font-medium transition-colors
              ${editMode === 'create' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Create
          </button>
        </div>
      </div>

      {/* Add / Remove buttons */}
      <div className="mt-2 flex gap-1">
        <button
          onClick={handleAdd}
          className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
        <button
          onClick={handleRemove}
          disabled={!selectedAllocationId}
          className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus className="h-3 w-3" /> Remove
        </button>
      </div>
    </div>
  );
}
