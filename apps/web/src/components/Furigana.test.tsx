import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Furigana } from './Furigana.js';

describe('Furigana', () => {
  it('renders ruby markup for segments with a reading', () => {
    render(<Furigana segments={[{ base: '日本', reading: 'にほん' }]} />);
    const ruby = document.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.textContent).toContain('日本');
    expect(screen.getByText('にほん').tagName).toBe('RT');
  });

  it('falls back to plain text without ruby when reading is empty', () => {
    render(<Furigana segments={[{ base: 'は', reading: '' }]} />);
    expect(document.querySelector('ruby')).toBeNull();
    expect(document.querySelector('rt')).toBeNull();
    expect(screen.getByText('は').tagName).toBe('SPAN');
  });

  it('sets lang="ja" on the wrapping element', () => {
    render(<Furigana segments={[{ base: '日', reading: 'ひ' }]} />);
    const wrapper = document.querySelector('[lang="ja"]');
    expect(wrapper).not.toBeNull();
  });
});
