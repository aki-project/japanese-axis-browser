export function EntrySkeleton() {
  return (
    <div role="status" aria-label="Loading entry" className="flex w-full flex-col items-center gap-3">
      <div className="h-16 w-32 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-64 animate-pulse rounded bg-slate-200" />
    </div>
  );
}
