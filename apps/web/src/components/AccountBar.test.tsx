import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ApiClientModule from '../api/client.js';
import { KnownEntriesProvider } from '../hooks/useKnownEntries.js';
import { AccountBar } from './AccountBar.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    getSession: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getCollections: vi.fn(),
    saveCollections: vi.fn(),
  };
});

import {
  ApiClientError,
  getCollections,
  getSession,
  login,
  logout,
  register,
  saveCollections,
} from '../api/client.js';
import { KnownCheckbox } from './KnownCheckbox.js';

function renderBar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KnownEntriesProvider>
        <AccountBar />
        <KnownCheckbox entryId="k:日" label="日" />
      </KnownEntriesProvider>
    </QueryClientProvider>,
  );
}

describe('AccountBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCollections).mockResolvedValue({
      collections: { kanji: [], vocab: [] },
      updatedAt: null,
      version: 0,
    });
  });

  it('registers with the era date field and then shows the user', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: null });
    vi.mocked(register).mockResolvedValue({ user: { username: 'aki' } });
    const user = userEvent.setup();
    renderBar();

    await user.click(await screen.findByRole('button', { name: 'Register' }));
    await user.type(screen.getByLabelText('Username'), 'aki');
    await user.type(screen.getByLabelText(/^Password/), 'password123');
    await user.type(screen.getByLabelText(/Japanese era/), '令和8年11月19日');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledWith({
      username: 'aki',
      password: 'password123',
      eraDate: '令和8年11月19日',
    });
    expect(await screen.findByText('aki')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('shows the server message when the era date is rejected', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: null });
    vi.mocked(register).mockRejectedValue(
      new ApiClientError(400, 'INVALID_ERA_DATE', "Enter today's date with the Japanese era."),
    );
    const user = userEvent.setup();
    renderBar();

    await user.click(await screen.findByRole('button', { name: 'Register' }));
    await user.type(screen.getByLabelText('Username'), 'aki');
    await user.type(screen.getByLabelText(/^Password/), 'password123');
    await user.type(screen.getByLabelText(/Japanese era/), '2026年11月19日');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Japanese era');
  });

  it('logs in and out', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: null });
    vi.mocked(login).mockResolvedValue({ user: { username: 'aki' } });
    vi.mocked(logout).mockResolvedValue({ user: null });
    const user = userEvent.setup();
    renderBar();

    await user.click(await screen.findByRole('button', { name: 'Log in' }));
    await user.type(screen.getByLabelText('Username'), 'aki');
    await user.type(screen.getByLabelText(/^Password/), 'password123');
    await user.click(screen.getAllByRole('button', { name: 'Log in' }).at(-1) as HTMLElement);
    expect(login).toHaveBeenCalledWith({ username: 'aki', password: 'password123' });

    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('button', { name: 'Register' })).toBeInTheDocument();
  });

  it('saves only on the Save button, and asks before logging out with unsaved changes', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { username: 'aki' } });
    vi.mocked(saveCollections).mockImplementation(({ collections, version }) =>
      Promise.resolve({ collections, updatedAt: null, version: version + 1 }),
    );
    vi.mocked(logout).mockResolvedValue({ user: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderBar();

    const box = await screen.findByRole('checkbox', { name: 'Known: 日' });
    await vi.waitFor(() => expect(box).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(box);
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');

    // Declining the prompt keeps the session and saves nothing.
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(confirm).toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(saveCollections).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveCollections).toHaveBeenCalledWith({
      username: 'aki',
      version: 0,
      collections: { kanji: ['k:日'], vocab: [] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');

    confirm.mockClear();
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(logout).toHaveBeenCalled());
    confirm.mockRestore();
  });
});
