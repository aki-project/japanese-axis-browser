import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useKeyboardNav } from './useKeyboardNav.js';

function Harness({
  onBack,
  onToggleAxis,
}: {
  onBack: () => void;
  onToggleAxis: (axis: 'semantic' | 'phonetic' | 'structural') => void;
}) {
  useKeyboardNav({ onBack, onToggleAxis });
  return (
    <>
      <input aria-label="search" />
      <input type="checkbox" aria-label="known" />
    </>
  );
}

describe('useKeyboardNav', () => {
  it('calls onBack for Backspace and [ when focus is not in a form field', () => {
    const onBack = vi.fn();
    const onToggleAxis = vi.fn();
    render(<Harness onBack={onBack} onToggleAxis={onToggleAxis} />);

    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: '[' });
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('toggles axes on S, P, K when focus is not in a form field', () => {
    const onBack = vi.fn();
    const onToggleAxis = vi.fn();
    render(<Harness onBack={onBack} onToggleAxis={onToggleAxis} />);

    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyDown(window, { key: 'P' });
    fireEvent.keyDown(window, { key: 'k' });

    expect(onToggleAxis).toHaveBeenNthCalledWith(1, 'semantic');
    expect(onToggleAxis).toHaveBeenNthCalledWith(2, 'phonetic');
    expect(onToggleAxis).toHaveBeenNthCalledWith(3, 'structural');
  });

  it('ignores every binding while focus is inside an input', () => {
    const onBack = vi.fn();
    const onToggleAxis = vi.fn();
    render(<Harness onBack={onBack} onToggleAxis={onToggleAxis} />);

    const input = screen.getByLabelText('search');
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 's' });

    expect(onBack).not.toHaveBeenCalled();
    expect(onToggleAxis).not.toHaveBeenCalled();
  });

  it('keeps the bindings active while a checkbox has focus', () => {
    const onBack = vi.fn();
    const onToggleAxis = vi.fn();
    render(<Harness onBack={onBack} onToggleAxis={onToggleAxis} />);

    const checkbox = screen.getByLabelText('known');
    fireEvent.keyDown(checkbox, { key: '[' });
    fireEvent.keyDown(checkbox, { key: 's' });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onToggleAxis).toHaveBeenCalledWith('semantic');
  });
});
