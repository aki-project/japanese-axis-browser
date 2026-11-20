import { useEffect } from 'react';
import type { Axis } from '@japanesesite/shared';

export interface KeyboardNavHandlers {
  onBack: () => void;
  onToggleAxis: (axis: Axis) => void;
}

/** Input types that take no typed text, so the shortcuts stay active on them. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Entry-page keyboard bindings: Backspace/`[` steps back along the trail,
 * `S`/`P`/`K` toggle the semantic/phonetic/structural axes. Tab and Enter
 * are left to native browser/anchor behaviour. Inactive while focus is in
 * a text input, textarea, or contenteditable element; a focused checkbox
 * (the known-entry toggles) keeps them active.
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
