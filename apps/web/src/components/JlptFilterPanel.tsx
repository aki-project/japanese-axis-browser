import { JLPT_FILTER_KEYS, type JlptFilterKey } from '@japanesesite/shared';
import type { JlptFilter } from '../hooks/useJlptFilter.js';

export interface JlptFilterPanelProps {
  filter: JlptFilter;
  onToggle: (key: JlptFilterKey) => void;
}

const LABELS: Record<JlptFilterKey, string> = {
  N5: 'N5',
  N4: 'N4',
  N3: 'N3',
  N2: 'N2',
  N1: 'N1',
  none: 'No level',
};

export function JlptFilterPanel({ filter, onToggle }: JlptFilterPanelProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 rounded border border-slate-200 px-3 py-2">
      <legend className="px-1 text-xs font-medium text-slate-500">JLPT level</legend>
      {JLPT_FILTER_KEYS.map((key) => {
        const inputId = `jlpt-filter-${key}`;
        return (
          <span key={key} className="flex items-center gap-1">
            <input
              id={inputId}
              type="checkbox"
              checked={filter[key]}
              onChange={() => onToggle(key)}
              className="h-4 w-4 rounded border-slate-400"
            />
            <label htmlFor={inputId} className="text-xs font-medium text-slate-600">
              {LABELS[key]}
            </label>
          </span>
        );
      })}
    </fieldset>
  );
}
