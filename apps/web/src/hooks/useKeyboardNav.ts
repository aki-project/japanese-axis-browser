import { useEffect } from 'react';
import type { Axis } from '@japanesesite/shared';

export interface KeyboardNavHandlers {
  onBack: () => void;
  onToggleAxis: (axis: Axis) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Entry-page keyboard bindings: Backspace/`[` steps back along the trail,
 * `S`/`P`/`K` toggle the semantic/phonetic/structural axes. Tab and Enter
 * are left to native browser/anchor behaviour. Inactive while focus is in
 * an input, textarea, or contenteditable element.
 */
export function useKeyboardNav({ onBack, onToggleAxis }: KeyboardNavHandlers): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'Backspace':
        case '[':
          event.preventDefault();
          onBack();
          break;
        case 's':
        case 'S':
          onToggleAxis('semantic');
          break;
        case 'p':
        case 'P':
          onToggleAxis('phonetic');
          break;
        case 'k':
        case 'K':
          onToggleAxis('structural');
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack, onToggleAxis]);
}
