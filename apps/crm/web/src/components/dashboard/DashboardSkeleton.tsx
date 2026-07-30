export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-7 w-40 bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-56 bg-slate-100 rounded animate-pulse mt-2" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 bg-slate-100 rounded-md animate-pulse" />
              <div className="h-4 w-12 bg-slate-100 rounded animate-pulse" />
            </div>
            <div className="h-7 w-20 bg-slate-200 rounded animate-pulse" />
            <div className="h-4 w-16 bg-slate-100 rounded animate-pulse mt-2" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm h-64">
            <div className="h-5 w-32 bg-slate-200 rounded animate-pulse mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="h-4 w-full bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
