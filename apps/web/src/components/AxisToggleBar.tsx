import { AXES, type Axis } from '@japanesesite/shared';
import { AXIS_META } from './axisMeta.js';
import type { AxisVisibility } from '../hooks/useAxisVisibility.js';

export interface AxisToggleBarProps {
  visibility: AxisVisibility;
  onToggle: (axis: Axis) => void;
}

export function AxisToggleBar({ visibility, onToggle }: AxisToggleBarProps) {
  return (
    <div role="group" aria-label="Toggle link axes" className="flex gap-2">
      {AXES.map((axis) => {
        const meta = AXIS_META[axis];
        const pressed = visibility[axis];
        return (
          <button
            key={axis}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(axis)}
            className={
              'rounded border px-2 py-1 text-xs font-medium ' +
              (pressed
                ? 'border-slate-600 bg-slate-700 text-white'
                : 'border-slate-300 text-slate-500')
            }
          >
            <span aria-hidden="true">{meta.glyph}</span> {meta.label}
          </button>
        );
      })}
    </div>
  );
}
