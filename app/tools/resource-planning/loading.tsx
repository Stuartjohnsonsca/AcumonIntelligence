export default function ResourcePlanningLoading() {
  return (
    <div className="flex h-screen animate-pulse">
      {/* Staff panel skeleton */}
      <div className="w-56 border-r bg-slate-50 flex flex-col">
        <div className="px-3 py-3 border-b">
          <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
          <div className="h-3 bg-slate-100 rounded w-1/2" />
        </div>
        <div className="flex-1 overflow-hidden p-2 space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-2 rounded">
              <div className="w-7 h-7 rounded-full bg-slate-200 flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-3 bg-slate-200 rounded w-4/5" />
                <div className="h-2 bg-slate-100 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline skeleton */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="h-12 border-b bg-white flex items-center px-4 gap-3">
          <div className="h-7 w-24 bg-slate-200 rounded" />
          <div className="h-7 w-20 bg-slate-200 rounded" />
          <div className="flex-1" />
          <div className="h-7 w-28 bg-slate-200 rounded" />
        </div>
        {/* Date bar */}
        <div className="h-8 border-b bg-slate-50 flex items-center px-4 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-3 bg-slate-200 rounded flex-1" />
          ))}
        </div>
        {/* Grid rows */}
        <div className="flex-1 p-2 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 bg-slate-50 rounded border border-slate-100 flex items-center px-3 gap-3">
              <div className="h-8 bg-slate-200 rounded w-1/4" />
              <div className="h-8 bg-slate-100 rounded w-1/3" />
              <div className="h-8 bg-slate-100 rounded w-1/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
