export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex w-full flex-col items-center gap-4 text-center">
      <h1 className="text-xl font-semibold text-slate-700">Something went wrong</h1>
      <p className="text-sm text-slate-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-slate-400 px-3 py-1 text-sm font-medium hover:bg-slate-50"
      >
        Retry
      </button>
    </div>
  );
}
