import type { JlptLevel } from '@japanesesite/shared';

export function JlptBadge({ level }: { level: JlptLevel | null }) {
  if (!level) return null;
  return (
    <span className="inline-block rounded border border-slate-400 px-2 py-0.5 text-xs font-semibold text-slate-700">
      JLPT {level}
    </span>
  );
}
